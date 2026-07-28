import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { listStoreMembers } from '../../../src/core/store/membership.js';
import {
  parseStoreProjectRecord,
  readStoreProjectRecord,
  serializeStoreProjectRecord,
  writeStoreProjectRecord,
  type StoreProjectRecord,
} from '../../../src/core/store/project-records.js';

const PROJECT_ID = '88888888-8888-4888-8888-888888888888';

describe('Store project-record knowledgeBundle locator', () => {
  let storeRoot: string;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-bundle-record-'));
  });

  afterEach(() => {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  });

  function record(overrides: Partial<StoreProjectRecord> = {}): StoreProjectRecord {
    return {
      version: 1,
      projectId: PROJECT_ID,
      id: 'portable-project',
      roles: { planning: true, knowledge: true },
      ...overrides,
    };
  }

  it('round-trips in fixed order and projects through membership explicitly', async () => {
    const input = record({
      remote: 'https://example.test/portable-project.git',
      knowledgeBundle: path.join('rasen', 'knowledge-bundles', 'portable.bundle.json'),
    });
    const serialized = serializeStoreProjectRecord(input);
    expect(serialized.indexOf('remote:')).toBeLessThan(serialized.indexOf('knowledgeBundle:'));
    expect(serialized.indexOf('knowledgeBundle:')).toBeLessThan(serialized.indexOf('roles:'));
    expect(parseStoreProjectRecord(serialized, 'record.yaml')).toEqual(input);

    await writeStoreProjectRecord(storeRoot, input);
    expect((await readStoreProjectRecord(storeRoot, PROJECT_ID)).record).toEqual(input);
    const listing = await listStoreMembers(
      { type: 'store', uid: 'store-uid', id: 'team-store', root: storeRoot }
    );
    expect(listing.members).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID,
        knowledgeBundle: input.knowledgeBundle,
        provenance: 'v2-record',
      }),
    ]);
  });

  it('keeps old records byte-identical and rejects an unknown field strictly', async () => {
    const oldBytes = serializeStoreProjectRecord(record());
    expect(oldBytes).not.toContain('knowledgeBundle');
    await writeStoreProjectRecord(storeRoot, record());
    const read = await readStoreProjectRecord(storeRoot, PROJECT_ID);
    expect(serializeStoreProjectRecord(read.record!)).toBe(oldBytes);
    expect(() =>
      parseStoreProjectRecord(
        `${oldBytes}knowledge_bundle: carry.bundle.json\n`,
        'record.yaml'
      )
    ).toThrow(/Unrecognized key|unrecognized/i);
  });
});
