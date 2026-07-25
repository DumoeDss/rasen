import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  appendStoreMembershipHint,
  describeStoreMembershipHint,
  readProjectConfig,
  storeMembershipHintKey,
} from '../../src/core/project-config.js';

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
      ).toContain('upgrade-identity');
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
      expect(storeMembershipHintKey({ id: 'Team-Store' })).toBe('id:team-store');
      expect(describeStoreMembershipHint({ uid: UID_A })).toBe(UID_A);
      expect(describeStoreMembershipHint({ uid: UID_A, id: 'team-store' })).toBe('team-store');
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
      for (const machinePath of ['/home/me/store', 'C:\\Users\\me\\store', '\\\\server\\share']) {
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
});
