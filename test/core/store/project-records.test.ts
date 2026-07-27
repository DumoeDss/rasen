import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  WINDOWS_RESERVED_DEVICE_NAMES,
  deleteStoreProjectRecord,
  getStoreProjectRecordPath,
  getStoreProjectRecordsDir,
  isRecordableProjectIdentity,
  listStoreProjectRecords,
  mergeStoreProjectRoles,
  normalizeProjectIdentity,
  parseStoreProjectRecord,
  projectIdentityDiagnostic,
  projectIdentityRecordProblem,
  readStoreProjectRecord,
  sameProjectIdentity,
  serializeStoreProjectRecord,
  writeStoreProjectRecord,
  type StoreProjectRecord,
} from '../../../src/core/store/project-records.js';
import { StoreError } from '../../../src/core/store/errors.js';

const UUID = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';

function record(overrides: Partial<StoreProjectRecord> = {}): StoreProjectRecord {
  return {
    version: 1,
    projectId: UUID,
    id: 'elftia',
    roles: { planning: true, knowledge: false },
    ...overrides,
  };
}

/** Every file under `dir` with its bytes, for a byte-identical assertion. */
function snapshot(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.set(path.relative(dir, full), fs.readFileSync(full, 'utf-8'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

describe('store project membership records', () => {
  let storeRoot: string;

  beforeEach(() => {
    storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-project-records-'));
  });

  afterEach(() => {
    fs.rmSync(storeRoot, { recursive: true, force: true });
  });

  describe('schema', () => {
    it('round-trips a full record through serialize and parse', () => {
      const full = record({
        remote: 'git@github.com:org/elftia.git',
        roles: { planning: true, knowledge: true },
        adoption: {
          specs: ['fundraising'],
          changes: ['fundraising-p0-p1'],
          adoptedAt: '2026-07-25T10:00:00Z',
        },
      });

      expect(parseStoreProjectRecord(serializeStoreProjectRecord(full), 'r.yaml')).toEqual(full);
    });

    it('rejects an unknown key rather than tolerating it', () => {
      const content = serializeStoreProjectRecord(record()).concat('sourcePath: /home/me/app\n');
      expect(() => parseStoreProjectRecord(content, 'r.yaml')).toThrow(StoreError);
    });

    it('rejects a record that omits a role', () => {
      expect(() =>
        parseStoreProjectRecord(
          `version: 1\nprojectId: ${UUID}\nroles:\n  planning: true\n`,
          'r.yaml'
        )
      ).toThrow(StoreError);
    });

    it('keeps the two roles independently readable', () => {
      const knowledgeOnly = parseStoreProjectRecord(
        serializeStoreProjectRecord(record({ roles: { planning: false, knowledge: true } })),
        'r.yaml'
      );
      expect(knowledgeOnly.roles).toEqual({ planning: false, knowledge: true });

      const planningOnly = parseStoreProjectRecord(
        serializeStoreProjectRecord(record({ roles: { planning: true, knowledge: false } })),
        'r.yaml'
      );
      expect(planningOnly.roles).toEqual({ planning: true, knowledge: false });
    });

    it('never records a machine path: the shape has nowhere to put one', () => {
      const serialized = serializeStoreProjectRecord(
        record({
          remote: 'git@github.com:org/elftia.git',
          adoption: { specs: ['a'], changes: ['b'], adoptedAt: '2026-07-25T10:00:00Z' },
        })
      );
      expect(serialized).not.toMatch(/sourcePath/u);
      for (const value of Object.values(
        parseStoreProjectRecord(serialized, 'r.yaml') as unknown as Record<string, unknown>
      )) {
        if (typeof value === 'string') expect(path.isAbsolute(value)).toBe(false);
      }
    });
  });

  describe('recordable identities (design D3)', () => {
    it('accepts a UUID and a kebab id', () => {
      expect(isRecordableProjectIdentity(UUID)).toBe(true);
      expect(isRecordableProjectIdentity('my-app-2')).toBe(true);
    });

    it('refuses anything that is neither, naming the reason', () => {
      for (const bad of ['(unassigned)', 'My App', '', 'a/b', '..']) {
        expect(isRecordableProjectIdentity(bad), bad).toBe(false);
        expect(projectIdentityRecordProblem(bad), bad).toBeTruthy();
      }
    });

    it('refuses every name Windows reserves for a device, on every platform', () => {
      for (const reserved of WINDOWS_RESERVED_DEVICE_NAMES) {
        expect(isRecordableProjectIdentity(reserved), reserved).toBe(false);
        expect(isRecordableProjectIdentity(reserved.toUpperCase()), reserved).toBe(false);
        expect(projectIdentityRecordProblem(reserved)).toContain('Windows');
      }
      // The list is enumerated, not pattern-matched: com0/lpt0 are NOT reserved
      // and must stay recordable, or a legitimate project id is refused.
      expect(isRecordableProjectIdentity('com0')).toBe(true);
      expect(isRecordableProjectIdentity('lpt0')).toBe(true);
    });

    it('never alters an identity to make it fit a filename', () => {
      expect(() => getStoreProjectRecordPath(storeRoot, '(unassigned)')).toThrow(StoreError);
      expect(projectIdentityDiagnostic('(unassigned)')?.code).toBe('project_identity_unrecordable');
      expect(projectIdentityDiagnostic(UUID)).toBeNull();
    });

    it('normalizes case so one project cannot become two files', () => {
      expect(normalizeProjectIdentity(` ${UUID.toUpperCase()} `)).toBe(UUID);
      expect(getStoreProjectRecordPath(storeRoot, UUID.toUpperCase())).toBe(
        getStoreProjectRecordPath(storeRoot, UUID)
      );
    });
  });

  describe('paths', () => {
    it('resolves records under the store metadata directory with platform joins', () => {
      expect(getStoreProjectRecordsDir(storeRoot)).toBe(
        path.join(storeRoot, '.rasen-store', 'projects')
      );
      expect(getStoreProjectRecordPath(storeRoot, UUID)).toBe(
        path.join(storeRoot, '.rasen-store', 'projects', `${UUID}.yaml`)
      );
    });
  });

  describe('reading and writing', () => {
    it('writes a record and reads it back', async () => {
      const written = await writeStoreProjectRecord(storeRoot, record());
      expect(written).toBe(getStoreProjectRecordPath(storeRoot, UUID));

      const read = await readStoreProjectRecord(storeRoot, UUID);
      expect(read.record).toEqual(record());
      expect(read.diagnostics).toEqual([]);
    });

    it('reports a filename/identity disagreement without preferring either', async () => {
      await writeStoreProjectRecord(storeRoot, record());
      const other = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
      fs.renameSync(
        getStoreProjectRecordPath(storeRoot, UUID),
        getStoreProjectRecordPath(storeRoot, other)
      );

      const read = await readStoreProjectRecord(storeRoot, other);
      expect(read.record).toBeNull();
      expect(read.diagnostics[0]?.code).toBe('store_project_record_key_mismatch');
      expect(read.diagnostics[0]?.message).toContain(other);
      expect(read.diagnostics[0]?.message).toContain(UUID);

      const listing = await listStoreProjectRecords(storeRoot);
      expect(listing.records).toEqual([]);
      expect(listing.diagnostics[0]?.code).toBe('store_project_record_key_mismatch');
    });

    it('skips one broken record instead of blinding the whole roster', async () => {
      await writeStoreProjectRecord(storeRoot, record());
      const other = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
      fs.writeFileSync(
        getStoreProjectRecordPath(storeRoot, other),
        'version: 1\nnot: valid\n',
        'utf-8'
      );

      const listing = await listStoreProjectRecords(storeRoot);
      expect(listing.records.map((entry) => entry.projectId)).toEqual([UUID]);
      expect(listing.diagnostics).toHaveLength(1);
    });

    it('refuses a credential-bearing remote before writing anything', async () => {
      const before = snapshot(storeRoot);
      await expect(
        writeStoreProjectRecord(
          storeRoot,
          record({ remote: 'https://user:hunter2@example.test/x.git' })
        )
      ).rejects.toThrow(/credential/i);
      expect(snapshot(storeRoot)).toEqual(before);
    });

    it('leaves every file byte-identical on a read', async () => {
      await writeStoreProjectRecord(storeRoot, record());
      const before = snapshot(storeRoot);

      await listStoreProjectRecords(storeRoot);
      await readStoreProjectRecord(storeRoot, UUID);

      expect(snapshot(storeRoot)).toEqual(before);
    });

    it('creates no records directory when a store has none', async () => {
      const listing = await listStoreProjectRecords(storeRoot);
      expect(listing.records).toEqual([]);
      expect(fs.existsSync(getStoreProjectRecordsDir(storeRoot))).toBe(false);
    });

    it('returns null cleanly for a genuinely missing record (M4 ENOENT)', async () => {
      const read = await readStoreProjectRecord(storeRoot, UUID);
      expect(read.record).toBeNull();
      expect(read.diagnostics).toEqual([]);
    });

    it.skipIf(process.platform === 'win32')(
      'reports a diagnostic when a record file is unreadable (M4 EACCES)',
      async () => {
        // POSIX-only: chmod the record file to 000 so readFile fails with
        // EACCES. Pre-fix, the catch-all pathIsFile swallowed this as
        // "absent"; post-fix it surfaces a diagnostic. (On Windows, stat of
        // a path inside a non-directory yields ENOENT — the readdir test
        // below covers the same ENOENT-discrimination cross-platform.)
        const recordsDir = getStoreProjectRecordsDir(storeRoot);
        fs.mkdirSync(recordsDir, { recursive: true });
        const recordPath = getStoreProjectRecordPath(storeRoot, UUID);
        fs.writeFileSync(recordPath, 'not: valid\n', 'utf-8');
        fs.chmodSync(recordPath, 0o000);

        try {
          const read = await readStoreProjectRecord(storeRoot, UUID);
          expect(read.record).toBeNull();
          expect(read.diagnostics.length).toBeGreaterThan(0);
          expect(read.diagnostics[0]?.code).toBe('store_project_record_unreadable');
        } finally {
          fs.chmodSync(recordPath, 0o644);
        }
      }
    );

    it('listStoreProjectRecords throws for an unreadable records directory (M4)', async () => {
      // A file where a directory is expected → readdir throws ENOTDIR, not
      // ENOENT. Pre-fix: silently returns empty. Post-fix: throws StoreError.
      const recordsDir = getStoreProjectRecordsDir(storeRoot);
      fs.mkdirSync(path.dirname(recordsDir), { recursive: true });
      fs.writeFileSync(recordsDir, 'not a directory\n', 'utf-8');

      await expect(listStoreProjectRecords(storeRoot)).rejects.toThrow(
        /Cannot enumerate/u
      );
    });

    it('deletes a record, and reports the no-op when there is none', async () => {
      expect(await deleteStoreProjectRecord(storeRoot, UUID)).toBe(false);
      await writeStoreProjectRecord(storeRoot, record());
      expect(await deleteStoreProjectRecord(storeRoot, UUID)).toBe(true);
      expect((await readStoreProjectRecord(storeRoot, UUID)).record).toBeNull();
    });
  });

  describe('roles only ever widen', () => {
    it('never clears a role another command recorded', () => {
      expect(
        mergeStoreProjectRoles(
          { planning: true, knowledge: false },
          { planning: false, knowledge: true }
        )
      ).toEqual({ planning: true, knowledge: true });
    });

    it('starts from nothing when there is no existing record', () => {
      expect(mergeStoreProjectRoles(undefined, { planning: false, knowledge: true })).toEqual({
        planning: false,
        knowledge: true,
      });
    });
  });

  describe('sameProjectIdentity (M3 canonical comparison)', () => {
    it('recognizes the same UUID ignoring case', () => {
      const lower = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';
      const upper = '3C0F0A3E-9E2B-4A0E-8C2F-6D5B1F0A7E11';
      expect(sameProjectIdentity(lower, upper)).toBe(true);
    });

    it('recognizes the same identity ignoring surrounding whitespace', () => {
      expect(sameProjectIdentity('  elftia  ', 'elftia')).toBe(true);
    });

    it('does not match a defined value against undefined', () => {
      expect(sameProjectIdentity('elftia', undefined)).toBe(false);
    });
  });
});
