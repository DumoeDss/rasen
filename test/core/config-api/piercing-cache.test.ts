import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/project-registry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/core/project-registry.js')>();
  return { ...original, resolveRegistrationRoot: vi.fn() };
});

import { resolveRegistrationRoot } from '../../../src/core/project-registry.js';
import {
  cachedResolveRegistrationRoot,
  clearPiercingCache,
} from '../../../src/core/config-api/piercing-cache.js';

const resolveMock = vi.mocked(resolveRegistrationRoot);

describe('selector piercing cache', () => {
  let worktreeRoot: string;
  const mainRoot = 'E:\\repos\\project-main';

  beforeEach(async () => {
    worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-pierce-cache-'));
    // A linked-worktree shape: `.git` is a small file pointing elsewhere.
    await fs.writeFile(path.join(worktreeRoot, '.git'), 'gitdir: elsewhere\n');
    clearPiercingCache();
    resolveMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(worktreeRoot, { recursive: true, force: true });
  });

  it('reuses one pierce for sequential resolutions within the freshness window', async () => {
    resolveMock.mockResolvedValue(mainRoot);

    expect(await cachedResolveRegistrationRoot(worktreeRoot)).toBe(mainRoot);
    expect(await cachedResolveRegistrationRoot(worktreeRoot)).toBe(mainRoot);
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent resolutions for one root into a single pierce', async () => {
    let release!: (value: string) => void;
    resolveMock.mockImplementation(() => new Promise<string>((resolve) => (release = resolve)));

    const reads = Promise.all([
      cachedResolveRegistrationRoot(worktreeRoot),
      cachedResolveRegistrationRoot(worktreeRoot),
      cachedResolveRegistrationRoot(worktreeRoot),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resolveMock).toHaveBeenCalledTimes(1);
    release(mainRoot);

    expect(await reads).toEqual([mainRoot, mainRoot, mainRoot]);
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });

  it('re-pierces within the window when the .git link mtime changes (retarget)', async () => {
    resolveMock.mockResolvedValue(mainRoot);
    await cachedResolveRegistrationRoot(worktreeRoot);

    const bumped = new Date(Date.now() + 5_000);
    await fs.utimes(path.join(worktreeRoot, '.git'), bumped, bumped);

    await cachedResolveRegistrationRoot(worktreeRoot);
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });

  it('re-pierces after the freshness window expires', async () => {
    resolveMock.mockResolvedValue(mainRoot);

    await cachedResolveRegistrationRoot(worktreeRoot, 10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await cachedResolveRegistrationRoot(worktreeRoot, 10);

    expect(resolveMock).toHaveBeenCalledTimes(2);
  });

  it('keeps distinct roots in distinct slots', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'rasen-pierce-cache-b-'));
    try {
      resolveMock.mockImplementation(async (p: string) => p + '-main');

      expect(await cachedResolveRegistrationRoot(worktreeRoot)).toBe(worktreeRoot + '-main');
      expect(await cachedResolveRegistrationRoot(other)).toBe(other + '-main');
      expect(resolveMock).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('clearPiercingCache forces the next resolution to re-pierce', async () => {
    resolveMock.mockResolvedValue(mainRoot);

    await cachedResolveRegistrationRoot(worktreeRoot);
    clearPiercingCache();
    await cachedResolveRegistrationRoot(worktreeRoot);

    expect(resolveMock).toHaveBeenCalledTimes(2);
  });
});
