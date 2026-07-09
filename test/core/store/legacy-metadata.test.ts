import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  STORE_METADATA_DIR_NAME,
  LEGACY_STORE_METADATA_DIR_NAME,
  STORE_METADATA_FILE_NAME,
  getStoreMetadataPath,
  getLegacyStoreMetadataPath,
  isStoreRoot,
  readStoreMetadataState,
  writeStoreMetadataState,
  copyForwardLegacyStoreMetadata,
} from '../../../src/core/store/index.js';

/**
 * Store metadata directory rename with legacy read compatibility (spec:
 * store-registration). New writes use `.rasen-store/`; a root with only the
 * legacy `.openspec-store/` still resolves; copy-forward creates the rasen
 * directory without touching the legacy one.
 */
describe('store metadata legacy compatibility', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-meta-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function seedLegacyMetadata(id: string): void {
    const dir = path.join(tempDir, LEGACY_STORE_METADATA_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, STORE_METADATA_FILE_NAME),
      `version: 1\nid: ${id}\n`,
      'utf-8'
    );
  }

  it('uses the rasen name as the canonical constant', () => {
    expect(STORE_METADATA_DIR_NAME).toBe('.rasen-store');
    expect(LEGACY_STORE_METADATA_DIR_NAME).toBe('.openspec-store');
  });

  it('new registration writes .rasen-store and never creates .openspec-store', async () => {
    await writeStoreMetadataState(tempDir, { version: 1, id: 'my-store' });

    expect(fs.existsSync(getStoreMetadataPath(tempDir))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, LEGACY_STORE_METADATA_DIR_NAME))).toBe(false);
  });

  it('recognizes and reads a legacy-only store root', async () => {
    seedLegacyMetadata('legacy-store');

    expect(await isStoreRoot(tempDir)).toBe(true);
    const state = await readStoreMetadataState(tempDir);
    expect(state.id).toBe('legacy-store');
  });

  it('copies legacy metadata forward to .rasen-store, leaving the legacy dir intact', async () => {
    seedLegacyMetadata('legacy-store');

    const copied = await copyForwardLegacyStoreMetadata(tempDir);
    expect(copied).toBe(true);

    // New metadata now present and correct.
    expect(fs.existsSync(getStoreMetadataPath(tempDir))).toBe(true);
    const state = await readStoreMetadataState(tempDir);
    expect(state.id).toBe('legacy-store');

    // Legacy directory untouched.
    expect(fs.existsSync(getLegacyStoreMetadataPath(tempDir))).toBe(true);
    expect(
      fs.readFileSync(getLegacyStoreMetadataPath(tempDir), 'utf-8')
    ).toContain('id: legacy-store');
  });

  it('copy-forward is a no-op when rasen metadata already exists', async () => {
    await writeStoreMetadataState(tempDir, { version: 1, id: 'my-store' });
    seedLegacyMetadata('other');

    const copied = await copyForwardLegacyStoreMetadata(tempDir);
    expect(copied).toBe(false);
    // Canonical read still prefers the rasen metadata.
    const state = await readStoreMetadataState(tempDir);
    expect(state.id).toBe('my-store');
  });
});
