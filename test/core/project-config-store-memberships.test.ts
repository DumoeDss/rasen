import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  appendStoreMembershipHint,
  backfillStoreMembershipUid,
  describeStoreMembershipHint,
  readProjectConfig,
  storeMembershipHintKey,
} from '../../src/core/project-config.js';
import { _resetConfigDiagnosticDedup } from '../../src/core/config-diagnostics.js';
import {
  acquireOwnerAwareFileLock,
  machineLockPath,
  releaseOwnerAwareFileLock,
} from '../../src/core/file-state.js';

const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';

describe('project-side store membership hints', () => {
  let projectRoot: string;
  let configPath: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-hints-'));
    configPath = path.join(projectRoot, 'rasen', 'config.yaml');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'schema: spec-driven\n', 'utf-8');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetConfigDiagnosticDedup();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function write(content: string): void {
    fs.writeFileSync(configPath, content, 'utf-8');
  }

  describe('parsing', () => {
    it('reads the object form, the identity form, and a bare display name', () => {
      write(
        [
          'schema: spec-driven',
          'storeMemberships:',
          `  - uid: ${UID_A}`,
          '    id: team-store',
          '    remote: git@github.com:org/team-store.git',
          `  - ${UID_B}`,
          '  - knowledge-store',
          '',
        ].join('\n')
      );

      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { uid: UID_A, id: 'team-store', remote: 'git@github.com:org/team-store.git' },
        { uid: UID_B },
        { id: 'knowledge-store' },
      ]);
    });

    it('drops one malformed entry with a warning and keeps the rest', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      write(
        [
          'schema: spec-driven',
          'storeMemberships:',
          `  - uid: ${UID_A}`,
          '    id: team-store',
          '  - 42',
          '  - {}',
          '  - knowledge-store',
          '',
        ].join('\n')
      );

      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { uid: UID_A, id: 'team-store' },
        { id: 'knowledge-store' },
      ]);
      expect(warn).toHaveBeenCalled();
    });

    it('drops the whole field, with a warning, when it is not a list', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      write('schema: spec-driven\nstoreMemberships: team-store\n');

      expect(readProjectConfig(projectRoot)?.storeMemberships).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });

    it('keeps an identity-less hint but names the upgrade path', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      write('schema: spec-driven\nstoreMemberships:\n  - team-store\n');

      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([{ id: 'team-store' }]);
      expect(
        warn.mock.calls.flat().join(' ')
      ).toContain('rasen update');
    });

    it('de-duplicates on permanent identity and fills a missing field', () => {
      write(
        [
          'schema: spec-driven',
          'storeMemberships:',
          `  - uid: ${UID_A}`,
          `  - uid: ${UID_A}`,
          '    id: team-store',
          '    remote: git@github.com:org/team-store.git',
          '',
        ].join('\n')
      );

      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { uid: UID_A, id: 'team-store', remote: 'git@github.com:org/team-store.git' },
      ]);
    });

    it('keys de-duplication on the alias only when there is no identity', () => {
      expect(storeMembershipHintKey({ uid: UID_A, id: 'team-store' })).toBe(`uid:${UID_A}`);
      expect(storeMembershipHintKey({ id: 'Team-Store' })).toBe('id:Team-Store');
      expect(describeStoreMembershipHint({ uid: UID_A })).toBe(UID_A);
      expect(describeStoreMembershipHint({ uid: UID_A, id: 'team-store' })).toBe('team-store');
    });

    it('preserves identityless Store aliases that differ only by case', () => {
      write(
        [
          'schema: spec-driven',
          'storeMemberships:',
          '  - Acme',
          '  - acme',
          '',
        ].join('\n')
      );

      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { id: 'Acme' },
        { id: 'acme' },
      ]);
    });
  });

  describe('writing', () => {
    it('appends a hint and round-trips it', async () => {
      const result = await appendStoreMembershipHint(projectRoot, {
        uid: UID_A,
        id: 'team-store',
        remote: 'git@github.com:org/team-store.git',
      });

      expect(result.changed).toBe(true);
      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { uid: UID_A, id: 'team-store', remote: 'git@github.com:org/team-store.git' },
      ]);
    });

    it('preserves every other field and the file comments', async () => {
      write(
        [
          '# project config',
          'schema: spec-driven',
          'projectId: p1',
          'references:',
          '  - platform-context',
          '',
        ].join('\n')
      );

      await appendStoreMembershipHint(projectRoot, { uid: UID_A, id: 'team-store' });

      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('# project config');
      expect(content).toContain('projectId: p1');
      const config = readProjectConfig(projectRoot);
      expect(config?.schema).toBe('spec-driven');
      expect(config?.references).toEqual([{ id: 'platform-context' }]);
    });

    it('is a no-op when an equivalent hint is already recorded', async () => {
      await appendStoreMembershipHint(projectRoot, { uid: UID_A, id: 'team-store' });
      const before = fs.readFileSync(configPath, 'utf-8');

      const second = await appendStoreMembershipHint(projectRoot, { uid: UID_A, id: 'team-store' });

      expect(second.changed).toBe(false);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
    });

    it('de-duplicates on identity rather than adding a second entry', async () => {
      await appendStoreMembershipHint(projectRoot, { uid: UID_A });
      await appendStoreMembershipHint(projectRoot, {
        uid: UID_A,
        id: 'team-store',
        remote: 'git@github.com:org/team-store.git',
      });

      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { uid: UID_A, id: 'team-store', remote: 'git@github.com:org/team-store.git' },
      ]);
    });

    it('refuses to write a filesystem path, on any platform', async () => {
      const machinePaths = [
        '/home/me/store',
        'C:\\Users\\me\\store',
        '\\\\server\\share',
        // Single-backslash root-relative (resolves to current-drive root on Windows)
        '\\Users\\team\\repo',
        // NT-namespace path
        '\\??\\C:\\Users\\team\\repo',
        // Win32 device namespace
        '\\\\?\\C:\\Users\\team\\repo',
      ];
      for (const machinePath of machinePaths) {
        await expect(
          appendStoreMembershipHint(projectRoot, { uid: UID_A, remote: machinePath })
        ).rejects.toThrow(/filesystem path/i);
      }
      expect(readProjectConfig(projectRoot)?.storeMemberships).toBeUndefined();
    });

    it('writes no absolute path, checked over parsed values rather than the raw text', async () => {
      await appendStoreMembershipHint(projectRoot, {
        uid: UID_A,
        id: 'team-store',
        remote: 'git@github.com:org/team-store.git',
      });

      for (const hint of readProjectConfig(projectRoot)?.storeMemberships ?? []) {
        for (const value of Object.values(hint)) {
          expect(typeof value === 'string' && path.isAbsolute(value)).toBe(false);
        }
      }
    });

    it('refuses a hint that names no store at all', async () => {
      await expect(appendStoreMembershipHint(projectRoot, {})).rejects.toThrow(/permanent identity/i);
    });

    it('reports a missing config rather than inventing one', async () => {
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-hints-bare-'));
      try {
        await expect(
          appendStoreMembershipHint(bare, { uid: UID_A, id: 'team-store' })
        ).rejects.toThrow(/rasen init/i);
        expect(fs.existsSync(path.join(bare, 'rasen'))).toBe(false);
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });
  });

  describe('concurrent appends (M8 owner-aware lock)', () => {
    const UID_C = '33333333-3333-4333-8333-333333333333';

    afterEach(() => {
      // Clean the machineLockPath lock for the test config.
      const abs = path.resolve(configPath);
      fs.rmSync(machineLockPath(abs), { force: true });
    });

    it('preserves both hints when two concurrent appends target different Stores', async () => {
      // Seed with one existing hint so the test is about ADDING, not the
      // first write.
      await appendStoreMembershipHint(projectRoot, { uid: UID_A, id: 'team-store' });

      // Pre-acquire the lock so both appends queue deterministically. Without
      // this, Promise.all might complete one append before the other starts,
      // trivially passing without real contention.
      const abs = path.resolve(configPath);
      const lockPath = machineLockPath(abs);
      const block = await acquireOwnerAwareFileLock({
        lockPath,
        errorFor: () => new Error('test-block'),
      });

      const promise = Promise.all([
        appendStoreMembershipHint(projectRoot, { uid: UID_B }),
        appendStoreMembershipHint(projectRoot, { uid: UID_C }),
      ]);

      // Let both appends hit the lock.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await releaseOwnerAwareFileLock(block);

      const [r1, r2] = await promise;
      expect(r1.changed).toBe(true);
      expect(r2.changed).toBe(true);

      // ALL THREE hints survive — the original plus both concurrent appends.
      // Without the lock, one of B/C would be silently lost (last-writer-wins
      // on the snapshot taken before the lock was acquired).
      const uids = (readProjectConfig(projectRoot)?.storeMemberships ?? [])
        .map((h) => h.uid)
        .sort();
      expect(uids).toEqual([UID_A, UID_B, UID_C].sort());

      // Lock file cleaned up by the last writer.
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('does not duplicate when two concurrent appends target the same Store', async () => {
      // Seed with one existing hint.
      await appendStoreMembershipHint(projectRoot, { uid: UID_A, id: 'team-store' });

      const abs = path.resolve(configPath);
      const lockPath = machineLockPath(abs);
      const block = await acquireOwnerAwareFileLock({
        lockPath,
        errorFor: () => new Error('test-block'),
      });

      const promise = Promise.all([
        appendStoreMembershipHint(projectRoot, { uid: UID_B, id: 'knowledge-store' }),
        appendStoreMembershipHint(projectRoot, { uid: UID_B, id: 'knowledge-store' }),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 100));
      await releaseOwnerAwareFileLock(block);

      const [r1, r2] = await promise;

      // Exactly ONE entry for UID_B — the existing dedup-by-UID logic is
      // preserved under contention.
      const hints = readProjectConfig(projectRoot)?.storeMemberships ?? [];
      const bHints = hints.filter((h) => h.uid === UID_B);
      expect(bHints).toHaveLength(1);
    });

    it('the lock file does not live inside the project git repo', async () => {
      // Verify the lock is created in os.tmpdir(), not next to the config.
      const abs = path.resolve(configPath);
      const lockPath = machineLockPath(abs);

      await appendStoreMembershipHint(projectRoot, { uid: UID_B });

      // After the call, the lock should be gone (released). But the PATH
      // it would have used must be outside the project root.
      expect(lockPath.startsWith(projectRoot)).toBe(false);
      expect(lockPath.startsWith(path.join(os.tmpdir(), 'rasen-locks'))).toBe(true);

      // And no lock file leaked into the project tree.
      function walk(dir: string): string[] {
        const found: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) found.push(...walk(full));
          else if (entry.name.endsWith('.lock')) found.push(full);
        }
        return found;
      }
      expect(walk(projectRoot)).toEqual([]);
    });
  });

  describe('backfillStoreMembershipUid', () => {
    afterEach(() => {
      const abs = path.resolve(configPath);
      fs.rmSync(machineLockPath(abs), { force: true });
    });

    it('backfills a uid into an identityless entry', async () => {
      write(
        [
          'schema: spec-driven',
          'storeMemberships:',
          '  - id: store-a',
          '',
        ].join('\n')
      );

      const result = await backfillStoreMembershipUid(projectRoot, {
        id: 'store-a',
        uid: UID_A,
      });

      expect(result.changed).toBe(true);
      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { uid: UID_A, id: 'store-a' },
      ]);
    });

    it('is a no-op when no matching identityless entry exists', async () => {
      write(
        [
          'schema: spec-driven',
          'storeMemberships:',
          '  - id: other-store',
          '',
        ].join('\n')
      );

      const result = await backfillStoreMembershipUid(projectRoot, {
        id: 'store-a',
        uid: UID_A,
      });

      expect(result.changed).toBe(false);
      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { id: 'other-store' },
      ]);
    });

    it('is a no-op when no storeMemberships exist at all', async () => {
      write('schema: spec-driven\n');

      const result = await backfillStoreMembershipUid(projectRoot, {
        id: 'store-a',
        uid: UID_A,
      });

      expect(result.changed).toBe(false);
    });

    it('does not modify a hint that already has a uid', async () => {
      write(
        [
          'schema: spec-driven',
          'storeMemberships:',
          `  - uid: ${UID_B}`,
          '    id: store-a',
          '',
        ].join('\n')
      );

      const result = await backfillStoreMembershipUid(projectRoot, {
        id: 'store-a',
        uid: UID_A,
      });

      expect(result.changed).toBe(false);
      expect(readProjectConfig(projectRoot)?.storeMemberships).toEqual([
        { uid: UID_B, id: 'store-a' },
      ]);
    });

    it('preserves other entries, comments, and field ordering', async () => {
      write(
        [
          '# project config',
          'schema: spec-driven',
          'projectId: p1',
          'storeMemberships:',
          '  - id: store-a',
          '    remote: git@github.com:org/store-a.git',
          '  - id: store-b',
          '',
        ].join('\n')
      );

      await backfillStoreMembershipUid(projectRoot, {
        id: 'store-a',
        uid: UID_A,
      });

      const content = fs.readFileSync(configPath, 'utf-8');
      expect(content).toContain('# project config');
      expect(content).toContain('projectId: p1');

      const config = readProjectConfig(projectRoot);
      expect(config?.storeMemberships).toEqual([
        { uid: UID_A, id: 'store-a', remote: 'git@github.com:org/store-a.git' },
        { id: 'store-b' },
      ]);
    });

    it('backfills the surviving entry when duplicates exist', async () => {
      // Two entries with the same alias collapse on parse (same dedup key).
      // The writer backfills the one surviving entry.
      write(
        [
          'schema: spec-driven',
          'storeMemberships:',
          '  - id: store-a',
          '  - id: store-b',
          '  - id: store-a',
          '',
        ].join('\n')
      );

      const result = await backfillStoreMembershipUid(projectRoot, {
        id: 'store-a',
        uid: UID_A,
      });

      expect(result.changed).toBe(true);
      // After backfill, the deduplicated entry carries the uid.
      const hints = readProjectConfig(projectRoot)?.storeMemberships ?? [];
      expect(hints).toEqual([
        { uid: UID_A, id: 'store-a' },
        { id: 'store-b' },
      ]);
    });
  });
});
