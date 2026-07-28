/**
 * Zed thread-database access layer (the Zed analog of `discover-codex.ts`) —
 * the single module that touches SQLite. It resolves the per-OS default
 * `threads.db` location, opens it read-only through a pure-JS/WASM reader
 * (`node-sqlite3-wasm`, no external tools), resolves a thread id by exact
 * match or prefix, and fetches either a thread family (root + its transitive
 * `parent_id` descendants, via a parameterized recursive CTE) or every thread
 * row (for the first-command scan).
 *
 * Everything SQLite-specific stays here so `decode.ts` and the `runZedAudit`
 * orchestration remain reader-agnostic. Row values arrive as the reader's
 * `SQLiteValue`; the `data` BLOB is a `Uint8Array`, kept raw for `decode.ts`
 * to decompress.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import sqlite3Wasm from 'node-sqlite3-wasm';

const { Database } = sqlite3Wasm;
export type ZedDatabase = InstanceType<typeof Database>;

/** One `threads` row, with the compressed payload kept raw for `decode.ts`. */
export interface ZedThreadRow {
  id: string;
  summary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  dataType: string;
  parentId: string | null;
  folderPaths: string | null;
  data: Uint8Array;
}

/** Metadata-only row used by management discovery. Deliberately excludes the payload BLOB. */
export type ZedThreadMetadata = Omit<ZedThreadRow, 'data' | 'dataType'>;

/** Columns every query selects, in a stable order. */
const THREAD_COLUMNS = ['id', 'summary', 'created_at', 'updated_at', 'data_type', 'parent_id', 'folder_paths', 'data'];
const SELECT_COLS = THREAD_COLUMNS.join(', ');
const CHILD_COLS = THREAD_COLUMNS.map((c) => `child.${c}`).join(', ');

export interface ZedDbPathOptions {
  homedir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Per-OS default location of Zed's thread database, built with `path.join`
 * so separators are platform-native. macOS is confirmed against a live
 * install; Linux follows the XDG data directory; Windows uses `LOCALAPPDATA`
 * (best-effort — Zed's Windows build is preview, and `--db` always overrides).
 */
export function resolveDefaultZedDbPath(options: ZedDbPathOptions = {}): string {
  const home = options.homedir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Zed', 'threads', 'threads.db');
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    return path.join(base, 'Zed', 'threads', 'threads.db');
  }
  const base = env.XDG_DATA_HOME ?? path.join(home, '.local', 'share');
  return path.join(base, 'zed', 'threads', 'threads.db');
}

function toStringOrNull(v: unknown): string | null {
  if (typeof v === 'string') return v;
  return v == null ? null : String(v);
}

function toBytes(v: unknown, id: string): Uint8Array {
  if (v instanceof Uint8Array) return v;
  throw new Error(`Zed thread "${id}" has a non-BLOB data column`);
}

function mapRow(row: Record<string, unknown>): ZedThreadRow {
  const id = String(row.id);
  return {
    id,
    summary: toStringOrNull(row.summary),
    createdAt: toStringOrNull(row.created_at),
    updatedAt: toStringOrNull(row.updated_at),
    dataType: String(row.data_type),
    parentId: toStringOrNull(row.parent_id),
    folderPaths: toStringOrNull(row.folder_paths),
    data: toBytes(row.data, id),
  };
}

/** Opens the database read-only; throws a friendly error when it is absent/unreadable. */
export function openZedDatabase(dbPath: string): ZedDatabase {
  try {
    return new Database(dbPath, { fileMustExist: true, readOnly: true });
  } catch {
    throw new Error(`Zed thread database not found or unreadable: ${dbPath} (pass --db <path>)`);
  }
}

/** Escapes LIKE metacharacters so a prefix is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Thread ids matching `idOrPrefix` exactly, else by prefix — empty when none
 * match, more than one only for an ambiguous prefix. All values are bound
 * parameters (no string interpolation into SQL).
 */
export function resolveThreadIdsByPrefix(db: ZedDatabase, idOrPrefix: string): string[] {
  const exact = db.all('SELECT id FROM threads WHERE id = ?', [idOrPrefix]);
  if (exact.length > 0) return exact.map((r) => String(r.id));
  const like = db.all("SELECT id FROM threads WHERE id LIKE ? ESCAPE '\\' ORDER BY id", [`${escapeLike(idOrPrefix)}%`]);
  return like.map((r) => String(r.id));
}

/**
 * The root thread plus its transitive `parent_id` descendants, via a
 * parameterized recursive CTE (the root id is a bound parameter). Ordered by
 * `created_at, id`.
 */
export function queryThreadFamily(db: ZedDatabase, rootId: string): ZedThreadRow[] {
  const rows = db.all(
    `WITH RECURSIVE thread_tree AS (
       SELECT ${SELECT_COLS} FROM threads WHERE id = ?
       UNION ALL
       SELECT ${CHILD_COLS} FROM threads AS child
       JOIN thread_tree AS parent ON child.parent_id = parent.id
     )
     SELECT ${SELECT_COLS} FROM thread_tree ORDER BY created_at, id`,
    [rootId]
  );
  return rows.map(mapRow);
}

/** Every thread row (used for the `--match` first-command scan). */
export function queryAllThreadRows(db: ZedDatabase): ZedThreadRow[] {
  return db.all(`SELECT ${SELECT_COLS} FROM threads ORDER BY created_at, id`).map(mapRow);
}

/**
 * Root-thread metadata for discovery. The LIMIT is applied by SQLite before
 * rows are materialized and the large compressed `data` column is never read.
 */
export function queryRecentRootThreadMetadata(db: ZedDatabase, limit: number): ZedThreadMetadata[] {
  const bounded = Math.max(1, Math.trunc(limit));
  return db
    .all(
      `SELECT id, summary, created_at, updated_at, parent_id, folder_paths
       FROM threads
       WHERE parent_id IS NULL
       ORDER BY COALESCE(updated_at, created_at) DESC, id
       LIMIT ?`,
      [bounded]
    )
    .map((row) => ({
      id: String(row.id),
      summary: toStringOrNull(row.summary),
      createdAt: toStringOrNull(row.created_at),
      updatedAt: toStringOrNull(row.updated_at),
      parentId: toStringOrNull(row.parent_id),
      folderPaths: toStringOrNull(row.folder_paths),
    }));
}

/** Exact metadata-only root lookup used before native audit execution. */
export function queryRootThreadIds(db: ZedDatabase, id: string): string[] {
  return db
    .all('SELECT id FROM threads WHERE parent_id IS NULL AND id = ? LIMIT 2', [id])
    .map((row) => String(row.id));
}
