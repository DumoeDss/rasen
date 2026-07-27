/**
 * M9 defense-in-depth: cloneRepository sanitizes credential-bearing URLs in
 * git's error output. The primary gate (assertCredentialFreeRemote in
 * cloneWithCleanupGuard) prevents credentials from reaching git at all, but
 * git's own error message echoes the raw URL — a future caller that bypasses
 * the guard must still never leak credentials into the StoreError surface.
 *
 * This file mocks execFile to simulate git echoing the URL, so the test is
 * deterministic and network-free.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock node:child_process BEFORE git.ts is imported, so the mock's execFile
// is captured by promisify inside git.ts. The mock simulates git echoing the
// raw remote URL in its error output.
vi.mock('node:child_process', () => {
  const mockExecFile = vi.fn();
  return { execFile: mockExecFile };
});

import { execFile } from 'node:child_process';
import { cloneRepository } from '../../../src/core/store/git.js';
import { StoreError } from '../../../src/core/store/errors.js';

const mockedExecFile = vi.mocked(execFile);

describe('M9 defense-in-depth — cloneRepository redacts credential-bearing URLs in errors', () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it('replaces the raw credential-bearing URL with the redacted form', async () => {
    const remote = 'https://user:secret@host.example.com/repo.git';
    const target = path.join(os.tmpdir(), 'm9-defense-target');

    // Simulate git echoing the raw URL in its clone-failure error.
    mockedExecFile.mockImplementation(
      (file, args, options, callback) => {
        const cb = typeof options === 'function' ? options : callback;
        if (typeof cb === 'function') {
          const err = new Error(
            `fatal: unable to access '${remote}': Could not resolve host: host.example.com`
          );
          (err as Error & { stderr: string }).stderr = '';
          cb(err, '', '');
        }
        return {} as never;
      }
    );

    await expect(cloneRepository(remote, target)).rejects.toThrow(/<redacted>/);
    await expect(cloneRepository(remote, target)).rejects.toThrow(/Failed to clone/);
    // The raw credential MUST NEVER appear in the StoreError message.
    await expect(cloneRepository(remote, target)).rejects.not.toThrow(/secret/);
    await expect(cloneRepository(remote, target)).rejects.not.toThrow(/user:secret/);
  });

  it('produces a StoreError (not a raw Error)', async () => {
    const remote = 'https://token@host.example.com/repo.git';
    const target = path.join(os.tmpdir(), 'm9-defense-typed');

    mockedExecFile.mockImplementation(
      (file, args, options, callback) => {
        const cb = typeof options === 'function' ? options : callback;
        if (typeof cb === 'function') {
          cb(new Error(`fatal: repository '${remote}' not found`), '', '');
        }
        return {} as never;
      }
    );

    try {
      await cloneRepository(remote, target);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError);
      expect((error as StoreError).diagnostic.code).toBe('store_clone_failed');
      expect((error as StoreError).diagnostic.message).toContain('<redacted>');
      expect((error as StoreError).diagnostic.message).not.toContain('token');
    }
  });

  it('leaves a credential-free remote unchanged in the error', async () => {
    const remote = 'https://host.example.com/repo.git';
    const target = path.join(os.tmpdir(), 'm9-defense-clean');

    mockedExecFile.mockImplementation(
      (file, args, options, callback) => {
        const cb = typeof options === 'function' ? options : callback;
        if (typeof cb === 'function') {
          cb(new Error(`fatal: repository '${remote}' not found`), '', '');
        }
        return {} as never;
      }
    );

    // No <redacted> form — the remote has no credentials.
    await expect(cloneRepository(remote, target)).rejects.toThrow(/Failed to clone/);
    await expect(cloneRepository(remote, target)).rejects.not.toThrow(/<redacted>/);
    // The clean URL still appears (it carries no secrets).
    await expect(cloneRepository(remote, target)).rejects.toThrow(/host\.example\.com/);
  });
});
