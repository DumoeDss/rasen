/**
 * B5 cleanup defense-in-depth: when a registration fails after creating
 * metadata, the catch-block cleanup must verify the metadata still belongs to
 * this transaction before deleting. If another registration overwrote it
 * (different id), the metadata must NOT be deleted.
 *
 * Uses vi.mock on node:fs to inject a failure at the registry rename step
 * (the last atomic write in updateStoreRegistryState) while simultaneously
 * overwriting the metadata file — simulating a stolen-stale-lock interleave.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// --- B5 fault injection: intercept promises.rename for the registry write ---
// vi.spyOn cannot patch ESM namespace exports, so we use vi.mock with a
// hoisted toggle. When enabled, renaming to registry.yaml overwrites the
// metadata file with a different id, then throws EIO — simulating another
// registration winning the race right before the registry update fails.
const { b5Fault } = vi.hoisted(() => ({
  b5Fault: {
    enabled: false,
    metadataPath: '' as string,
    overwriteId: '' as string,
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      rename: (async (oldPath: unknown, newPath: unknown) => {
        const target = typeof newPath === 'string' ? newPath : String(newPath);
        if (
          b5Fault.enabled &&
          target.endsWith('registry.yaml') &&
          b5Fault.metadataPath &&
          b5Fault.overwriteId
        ) {
          // Simulate another registration overwriting the metadata before the
          // registry write fails. Write the metadata directly.
          await actual.promises.writeFile(
            b5Fault.metadataPath,
            `version: 1\nid: ${b5Fault.overwriteId}\n`,
            'utf-8'
          );
          const err: NodeJS.ErrnoException = new Error(
            'EIO: simulated registry write failure (B5 test)'
          );
          err.code = 'EIO';
          throw err;
        }
        return actual.promises.rename(
          oldPath as Parameters<typeof actual.promises.rename>[0],
          newPath as Parameters<typeof actual.promises.rename>[1]
        );
      }) as typeof actual.promises.rename,
    },
  };
});

import { getStoreMetadataPath, getGlobalDataDir } from '../../../src/core/index.js';
import { commitStoreRegistration } from '../../../src/core/store/registry.js';
import { readStoreMetadataState } from '../../../src/core/store/foundation.js';
import { machineLockPath } from '../../../src/core/file-state.js';

describe('store registration cleanup defense-in-depth (B5)', () => {
  let tempDir: string;
  let savedXdg: string | undefined;
  let savedRasenHome: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-b5-cleanup-'));
    savedXdg = process.env.XDG_DATA_HOME;
    savedRasenHome = process.env.RASEN_HOME;
    delete process.env.RASEN_HOME;
    process.env.XDG_DATA_HOME = path.join(tempDir, 'data');
    b5Fault.enabled = false;
    b5Fault.metadataPath = '';
    b5Fault.overwriteId = '';
  });

  afterEach(() => {
    b5Fault.enabled = false;
    b5Fault.metadataPath = '';
    b5Fault.overwriteId = '';
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
    if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
    else process.env.RASEN_HOME = savedRasenHome;
    // Clean any registration lock file.
    const storeRoot = path.join(tempDir, 'store');
    fs.rmSync(machineLockPath(path.resolve(storeRoot)), { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not delete metadata overwritten by another registration', async () => {
    const storeRoot = path.join(tempDir, 'store');
    fs.mkdirSync(path.join(storeRoot, '.rasen-store'), { recursive: true });

    // Enable the fault: when the registry write is attempted, overwrite the
    // metadata to a different id (simulating a concurrent registration), then
    // throw EIO so the catch-block cleanup runs.
    b5Fault.enabled = true;
    b5Fault.metadataPath = getStoreMetadataPath(storeRoot);
    b5Fault.overwriteId = 'other-alias';

    await expect(
      commitStoreRegistration({
        id: 'acme',
        backend: { type: 'git', local_path: storeRoot },
        writeMetadataIfMissing: true,
        globalDataDir: getGlobalDataDir({ env: process.env }),
      })
    ).rejects.toThrow(/EIO|simulated/u);

    b5Fault.enabled = false;

    // The metadata still exists and belongs to the other registration, NOT
    // deleted by this transaction's cleanup. Pre-fix, the cleanup checked only
    // stillReferenced (false because the registry write failed) and deleted it.
    const metadata = await readStoreMetadataState(storeRoot);
    expect(metadata.id).toBe('other-alias');
  });
});
