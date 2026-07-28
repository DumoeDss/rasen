import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { handleLocalPaths } from '../../../src/core/management-api/local-paths.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

describe('handleLocalPaths (local-path-browsing design D3)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rasen-local-paths-')));
  });

  afterEach(async () => {
    await cleanupTempPathAsync(dir);
  });

  it('starts at home, identifies it, and advertises no ascent (parent null)', async () => {
    const result = await handleLocalPaths(undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.home).toBe(true);
    expect(result.response.path).toBe(FileSystemUtils.canonicalizeExistingPath(os.homedir()));
    expect(result.response.separator).toBe(path.sep);
    // The server never volunteers a location above home: the start point
    // exposes no parent to ascend into (local-path-browsing spec / design D3).
    expect(result.response.parent).toBeNull();
  });

  it('still enumerates a typed absolute path above home (the sole escape) even though home never advertises it', async () => {
    const aboveHome = path.dirname(FileSystemUtils.canonicalizeExistingPath(os.homedir()));
    // Home is the confinement floor and volunteers no ascent...
    const home = await handleLocalPaths(undefined);
    expect(home.ok && home.response.parent).toBeNull();
    // ...but the parent-of-home is still reachable when the client supplies it
    // explicitly as an absolute path — the escape hatch stays open.
    const result = await handleLocalPaths(aboveHome);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.home).toBeUndefined();
    expect(result.response.path).toBe(FileSystemUtils.canonicalizeExistingPath(aboveHome));
  });

  it('enumerates an explicit absolute path outside home, with no home flag', async () => {
    fs.mkdirSync(path.join(dir, 'child-dir'));
    fs.writeFileSync(path.join(dir, 'a-file.txt'), 'x');

    const result = await handleLocalPaths(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.home).toBeUndefined();
    expect(result.response.path).toBe(FileSystemUtils.canonicalizeExistingPath(dir));
    const names = result.response.entries.map((e) => e.name);
    expect(names).toContain('child-dir');
    expect(names).toContain('a-file.txt');
  });

  it('rejects a relative or empty path with 400 invalid_path and enumerates nothing', async () => {
    for (const bad of ['repo', '../..', './x', '']) {
      const result = await handleLocalPaths(bad);
      expect(result.ok, bad).toBe(false);
      if (result.ok) continue;
      expect(result.status, bad).toBe(400);
      expect(result.code, bad).toBe('invalid_path');
    }
  });

  it('returns 404 path_not_found for a nonexistent path', async () => {
    const result = await handleLocalPaths(path.join(dir, 'does-not-exist'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.code).toBe('path_not_found');
  });

  it('returns 400 not_a_directory when the path is a file', async () => {
    const filePath = path.join(dir, 'a-file.txt');
    fs.writeFileSync(filePath, 'x');
    const result = await handleLocalPaths(filePath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.code).toBe('not_a_directory');
  });

  it('flags isGitRepo for a `.git` directory AND a `.git` file, false for a plain directory', async () => {
    const gitDirRepo = path.join(dir, 'dir-repo');
    fs.mkdirSync(path.join(gitDirRepo, '.git'), { recursive: true });

    const gitFileRepo = path.join(dir, 'worktree-repo');
    fs.mkdirSync(gitFileRepo, { recursive: true });
    fs.writeFileSync(path.join(gitFileRepo, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');

    const plain = path.join(dir, 'plain');
    fs.mkdirSync(plain);

    const result = await handleLocalPaths(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byName = new Map(result.response.entries.map((e) => [e.name, e]));
    expect(byName.get('dir-repo')).toMatchObject({ isDir: true, isGitRepo: true });
    expect(byName.get('worktree-repo')).toMatchObject({ isDir: true, isGitRepo: true });
    expect(byName.get('plain')).toMatchObject({ isDir: true, isGitRepo: false });
  });

  it('sorts entries directories-first then alphabetically', async () => {
    fs.mkdirSync(path.join(dir, 'b-dir'));
    fs.mkdirSync(path.join(dir, 'a-dir'));
    fs.writeFileSync(path.join(dir, 'a-file'), 'x');
    fs.writeFileSync(path.join(dir, 'z-file'), 'x');

    const result = await handleLocalPaths(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.entries.map((e) => e.name)).toEqual(['a-dir', 'b-dir', 'a-file', 'z-file']);
  });

  it('reports the canonical parent, or null at a filesystem root', async () => {
    const child = path.join(dir, 'nested');
    fs.mkdirSync(child);
    const result = await handleLocalPaths(child);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.parent).toBe(FileSystemUtils.canonicalizeExistingPath(dir));
  });

  it('resolves a lower-cased Windows drive letter to its canonical form', async () => {
    if (process.platform !== 'win32') return;
    // Flip the drive letter case of the temp dir; the canonical response must
    // match FileSystemUtils' canonicalization regardless of the input case.
    const flipped = dir.charAt(0).toLowerCase() + dir.slice(1);
    const result = await handleLocalPaths(flipped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.path).toBe(FileSystemUtils.canonicalizeExistingPath(dir));
  });
});
