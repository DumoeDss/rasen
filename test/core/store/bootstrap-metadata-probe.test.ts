import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getLegacyStoreMetadataPath,
  getStoreMetadataPath,
  probeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-meta-probe-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('M11 — probeStoreMetadataState', () => {
  it('returns absent when neither modern nor legacy metadata exists', async () => {
    const root = path.join(tempDir, 'empty-store');
    createOpenSpecRoot(root);

    const probe = await probeStoreMetadataState(root);
    expect(probe.kind).toBe('absent');
  });

  it('returns valid when only legacy metadata exists', async () => {
    const root = path.join(tempDir, 'legacy-store');
    createOpenSpecRoot(root);
    const uid = mintStoreUid();
    // Write ONLY the legacy metadata path.
    fs.mkdirSync(path.dirname(getLegacyStoreMetadataPath(root)), { recursive: true });
    fs.writeFileSync(
      getLegacyStoreMetadataPath(root),
      `version: 2\nuid: ${uid}\nid: legacy-store\n`
    );

    const probe = await probeStoreMetadataState(root);
    expect(probe.kind).toBe('valid');
    if (probe.kind === 'valid') {
      expect(probe.metadata.version).toBe(2);
      expect(probe.metadata.id).toBe('legacy-store');
    }
  });

  it('returns unreadable when legacy metadata exists but is corrupt', async () => {
    const root = path.join(tempDir, 'corrupt-legacy');
    createOpenSpecRoot(root);
    // Write corrupt YAML at the legacy path only.
    fs.mkdirSync(path.dirname(getLegacyStoreMetadataPath(root)), { recursive: true });
    fs.writeFileSync(
      getLegacyStoreMetadataPath(root),
      'this: is: not: valid: yaml: ['
    );

    const probe = await probeStoreMetadataState(root);
    expect(probe.kind).toBe('unreadable');
    if (probe.kind === 'unreadable') {
      expect(probe.path).toBe(getLegacyStoreMetadataPath(root));
    }
  });

  it('returns unreadable when modern metadata is corrupt', async () => {
    const root = path.join(tempDir, 'corrupt-modern');
    createOpenSpecRoot(root);
    // Write corrupt YAML at the modern path.
    fs.mkdirSync(path.dirname(getStoreMetadataPath(root)), { recursive: true });
    fs.writeFileSync(
      getStoreMetadataPath(root),
      'this: is: not: valid: yaml: ['
    );

    const probe = await probeStoreMetadataState(root);
    expect(probe.kind).toBe('unreadable');
    if (probe.kind === 'unreadable') {
      expect(probe.path).toBe(getStoreMetadataPath(root));
    }
  });

  it('returns valid when modern metadata exists', async () => {
    const root = path.join(tempDir, 'modern-store');
    createOpenSpecRoot(root);
    const uid = mintStoreUid();
    fs.mkdirSync(path.dirname(getStoreMetadataPath(root)), { recursive: true });
    fs.writeFileSync(
      getStoreMetadataPath(root),
      `version: 2\nuid: ${uid}\nid: modern-store\n`
    );

    const probe = await probeStoreMetadataState(root);
    expect(probe.kind).toBe('valid');
    if (probe.kind === 'valid') {
      expect(probe.metadata.version).toBe(2);
      expect(probe.metadata.id).toBe('modern-store');
    }
  });
});
