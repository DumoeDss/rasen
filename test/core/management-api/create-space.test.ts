import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createSpaceCreator } from '../../../src/core/management-api/create-space.js';
import type { SpaceEntry } from '../../../src/core/management-api/wire-types.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fakeCliEntry = path.resolve(__dirname, '..', '..', 'fixtures', 'management-api', 'create-space-fake-cli.mjs');

/** Reads the fake CLI's argv log (one JSON array per invocation); [] when nothing spawned. */
function readArgvLog(logPath: string): string[][] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as string[]);
}

function listingOf(spaces: SpaceEntry[]): () => Promise<{ spaces: SpaceEntry[] }> {
  return async () => ({ spaces });
}

describe('createSpaceCreator (space-creation design D4/D5)', () => {
  let dir: string;
  let argvLog: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rasen-create-space-')));
    argvLog = path.join(dir, 'argv.log');
    process.env.RASEN_FAKE_ARGV_LOG = argvLog;
  });

  afterEach(async () => {
    delete process.env.RASEN_FAKE_ARGV_LOG;
    await cleanupTempPathAsync(dir);
  });

  describe('validation before spawn (spawns nothing)', () => {
    function creator() {
      return createSpaceCreator({ cliEntryOverride: fakeCliEntry, listSpacesOverride: listingOf([]) });
    }

    it('rejects a bad kind with 400', async () => {
      const result = await creator()({ kind: 'banana', path: dir });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(readArgvLog(argvLog)).toEqual([]);
    });

    it('rejects a relative path with 400', async () => {
      const result = await creator()({ kind: 'project', path: 'repo' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(readArgvLog(argvLog)).toEqual([]);
    });

    it('rejects an option-like path with 400 (absoluteness is the injection guard)', async () => {
      const result = await creator()({ kind: 'project', path: '--store=evil' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(readArgvLog(argvLog)).toEqual([]);
    });

    it('rejects a path with control characters with 400', async () => {
      const result = await creator()({ kind: 'project', path: path.join(dir, 'bad\x00name') });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(readArgvLog(argvLog)).toEqual([]);
    });

    it('rejects a fresh store with no id with 400', async () => {
      const fresh = path.join(dir, 'fresh-no-id');
      fs.mkdirSync(fresh);
      const result = await creator()({ kind: 'store', path: fresh });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(readArgvLog(argvLog)).toEqual([]);
    });

    it('rejects an id that fails the CLI store-id validation with 400', async () => {
      const result = await creator()({ kind: 'store', path: dir, id: '--evil Id' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(400);
      expect(readArgvLog(argvLog)).toEqual([]);
    });
  });

  describe('verb selection (exact argv)', () => {
    it('spawns `init <path>` for a project', async () => {
      const creator = createSpaceCreator({
        cliEntryOverride: fakeCliEntry,
        listSpacesOverride: listingOf([{ type: 'project', id: 'proj', name: 'Proj', root: dir }]),
      });
      const result = await creator({ kind: 'project', path: dir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.response.operation).toBe('init');
      expect(result.response.space.id).toBe('proj');
      expect(readArgvLog(argvLog)).toEqual([['init', dir]]);
    });

    it('spawns `store register <path> --yes --id <id> --json` when a rasen/ root exists', async () => {
      const storeDir = path.join(dir, 'existing-store');
      fs.mkdirSync(path.join(storeDir, 'rasen'), { recursive: true });
      const creator = createSpaceCreator({
        cliEntryOverride: fakeCliEntry,
        listSpacesOverride: listingOf([
          { type: 'store', id: 'team-store', name: 'team-store', root: storeDir, members: [] },
        ]),
      });
      const result = await creator({ kind: 'store', path: storeDir, id: 'team-store' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.response.operation).toBe('store-register');
      expect(result.response.space.id).toBe('team-store');
      expect(readArgvLog(argvLog)).toEqual([
        ['store', 'register', storeDir, '--yes', '--id', 'team-store', '--json'],
      ]);
    });

    it('spawns `store register <path> --yes --json` (no --id) when the id is omitted', async () => {
      const storeDir = path.join(dir, 'existing-store-noid');
      fs.mkdirSync(path.join(storeDir, 'rasen'), { recursive: true });
      const creator = createSpaceCreator({
        cliEntryOverride: fakeCliEntry,
        listSpacesOverride: listingOf([
          { type: 'store', id: 'registered-store', name: 'registered-store', root: storeDir, members: [] },
        ]),
      });
      const result = await creator({ kind: 'store', path: storeDir });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(readArgvLog(argvLog)).toEqual([['store', 'register', storeDir, '--yes', '--json']]);
    });

    it('spawns `store setup <id> --path <path> --json` for a fresh store', async () => {
      const fresh = path.join(dir, 'fresh-store');
      fs.mkdirSync(fresh);
      const creator = createSpaceCreator({
        cliEntryOverride: fakeCliEntry,
        listSpacesOverride: listingOf([
          { type: 'store', id: 'fresh-store', name: 'fresh-store', root: fresh, members: [] },
        ]),
      });
      const result = await creator({ kind: 'store', path: fresh, id: 'fresh-store' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.response.operation).toBe('store-setup');
      expect(readArgvLog(argvLog)).toEqual([['store', 'setup', 'fresh-store', '--path', fresh, '--json']]);
    });
  });

  describe('outcomes', () => {
    it('passes a project init failure through as 422 with exit code and stderr', async () => {
      const failDir = path.join(dir, 'FAKEFAIL-proj');
      const creator = createSpaceCreator({ cliEntryOverride: fakeCliEntry, listSpacesOverride: listingOf([]) });
      const result = await creator({ kind: 'project', path: failDir });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.code).toBe('cli_error');
      expect(result.cliExitCode).toBe(1);
      expect(result.message).toContain('fake init failure');
      expect(result.stderr).toContain('fake init failure');
    });

    it('passes a store failure JSON message through as 422', async () => {
      const failStore = path.join(dir, 'FAKEFAIL-store');
      fs.mkdirSync(path.join(failStore, 'rasen'), { recursive: true });
      const creator = createSpaceCreator({ cliEntryOverride: fakeCliEntry, listSpacesOverride: listingOf([]) });
      const result = await creator({ kind: 'store', path: failStore, id: 'team-store' });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(422);
      expect(result.message).toContain('fake store failure');
    });

    it('reports 500 cli_protocol_error when the new space is absent from the listing', async () => {
      const creator = createSpaceCreator({
        cliEntryOverride: fakeCliEntry,
        listSpacesOverride: listingOf([]), // success, but the space is not listed
      });
      const result = await creator({ kind: 'project', path: dir });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(500);
      expect(result.code).toBe('cli_protocol_error');
    });

    it('rejects an overlapping creation immediately with 409 busy', async () => {
      const slow = path.join(dir, 'FAKESLEEP300-proj');
      const creator = createSpaceCreator({
        cliEntryOverride: fakeCliEntry,
        listSpacesOverride: listingOf([{ type: 'project', id: 'proj', name: 'Proj', root: slow }]),
        timeoutMs: 5000,
      });

      const first = creator({ kind: 'project', path: slow });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const second = await creator({ kind: 'project', path: slow });

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.status).toBe(409);
      expect(second.code).toBe('busy');

      await first;
    });

    it('times out a hung subprocess with 504', async () => {
      const slow = path.join(dir, 'FAKESLEEP5000-proj');
      const creator = createSpaceCreator({
        cliEntryOverride: fakeCliEntry,
        listSpacesOverride: listingOf([]),
        timeoutMs: 200,
        killGraceMs: 100,
      });
      const result = await creator({ kind: 'project', path: slow });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe(504);
      expect(result.code).toBe('cli_timeout');
    });
  });
});
