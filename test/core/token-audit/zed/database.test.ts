import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  openZedDatabase,
  queryAllThreadRows,
  queryThreadFamily,
  resolveDefaultZedDbPath,
  resolveThreadIdsByPrefix,
} from '../../../../src/core/token-audit/zed/database.js';
import { buildZedDb } from '../../../helpers/zed-db.js';

describe('resolveDefaultZedDbPath', () => {
  it('uses the macOS Application Support location', () => {
    const p = resolveDefaultZedDbPath({ homedir: '/Users/x', platform: 'darwin', env: {} });
    expect(p).toBe(path.join('/Users/x', 'Library', 'Application Support', 'Zed', 'threads', 'threads.db'));
  });

  it('uses XDG_DATA_HOME (then ~/.local/share) on Linux', () => {
    expect(resolveDefaultZedDbPath({ homedir: '/home/x', platform: 'linux', env: { XDG_DATA_HOME: '/xdg' } })).toBe(
      path.join('/xdg', 'zed', 'threads', 'threads.db')
    );
    expect(resolveDefaultZedDbPath({ homedir: '/home/x', platform: 'linux', env: {} })).toBe(
      path.join('/home/x', '.local', 'share', 'zed', 'threads', 'threads.db')
    );
  });

  it('uses LOCALAPPDATA (then ~/AppData/Local) on Windows', () => {
    expect(
      resolveDefaultZedDbPath({ homedir: 'C:\\Users\\x', platform: 'win32', env: { LOCALAPPDATA: 'C:\\LA' } })
    ).toBe(path.join('C:\\LA', 'Zed', 'threads', 'threads.db'));
  });
});

describe('Zed database queries', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-zed-db-'));
    dbPath = path.join(dir, 'threads.db');
    buildZedDb(dbPath, [
      { id: 'root-aaaa-1111', summary: 'Root', createdAt: '2026-01-01T00:00:00Z', payload: { cumulative_token_usage: {} } },
      { id: 'child-bbbb-2222', summary: 'Child', parentId: 'root-aaaa-1111', createdAt: '2026-01-01T01:00:00Z', payload: { cumulative_token_usage: {} } },
      { id: 'grandchild-cccc', summary: 'Grandchild', parentId: 'child-bbbb-2222', createdAt: '2026-01-01T02:00:00Z', payload: { cumulative_token_usage: {} } },
      { id: 'unrelated-dddd', summary: 'Unrelated', createdAt: '2026-01-01T03:00:00Z', payload: { cumulative_token_usage: {} } },
    ]);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('opens read-only and throws a friendly error when the file is absent', () => {
    expect(() => openZedDatabase(path.join(dir, 'missing.db'))).toThrow(/not found or unreadable/);
  });

  it('resolves a thread id exactly or by unique prefix, and reports every ambiguous match', () => {
    const db = openZedDatabase(dbPath);
    try {
      expect(resolveThreadIdsByPrefix(db, 'root-aaaa-1111')).toEqual(['root-aaaa-1111']);
      expect(resolveThreadIdsByPrefix(db, 'grand')).toEqual(['grandchild-cccc']);
      expect(resolveThreadIdsByPrefix(db, 'zzz')).toEqual([]);
      // both child-* and (none else) — use a prefix hitting one; ambiguity via a shared prefix:
      const many = resolveThreadIdsByPrefix(db, '');
      expect(many.length).toBe(4);
    } finally {
      db.close();
    }
  });

  it('fetches the root and its transitive descendants only (recursive CTE)', () => {
    const db = openZedDatabase(dbPath);
    try {
      const family = queryThreadFamily(db, 'root-aaaa-1111').map((r) => r.id);
      expect(family).toEqual(['root-aaaa-1111', 'child-bbbb-2222', 'grandchild-cccc']);
      expect(family).not.toContain('unrelated-dddd');
    } finally {
      db.close();
    }
  });

  it('returns an empty family for an unknown root id', () => {
    const db = openZedDatabase(dbPath);
    try {
      expect(queryThreadFamily(db, 'nope')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('reads the data column back as a Uint8Array BLOB', () => {
    const db = openZedDatabase(dbPath);
    try {
      const rows = queryAllThreadRows(db);
      expect(rows).toHaveLength(4);
      expect(rows[0].data).toBeInstanceOf(Uint8Array);
    } finally {
      db.close();
    }
  });
});
