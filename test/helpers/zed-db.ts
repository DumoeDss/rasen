/**
 * Test helper: builds a temporary Zed-style `threads.db` from thread specs,
 * using the same pure-JS SQLite reader the production code reads with. Thread
 * payloads default to uncompressed `data_type: 'json'` (so tests need no zstd
 * compressor — Node-20 CI lacks `zlib` zstd, and `fzstd` is decompress-only);
 * pass explicit `data` + `dataType` for the zstd or corrupt-payload paths.
 */
import sqlite3Wasm from 'node-sqlite3-wasm';

const { Database } = sqlite3Wasm;

export interface ZedThreadSpec {
  id: string;
  summary?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  parentId?: string | null;
  /** Raw `folder_paths` column value (a JSON array string) or null. */
  folderPaths?: string | null;
  /** Defaults to 'json'. */
  dataType?: string;
  /** Explicit raw BLOB bytes (for the zstd or corrupt paths); overrides `payload`. */
  data?: Uint8Array;
  /** Stored as UTF-8 JSON bytes when `dataType` is 'json' and no `data` is given. */
  payload?: unknown;
}

export function buildZedDb(dbPath: string, threads: ZedThreadSpec[]): void {
  const db = new Database(dbPath);
  try {
    db.run(
      `CREATE TABLE threads (
        id TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL,
        data_type TEXT NOT NULL, data BLOB NOT NULL, parent_id TEXT,
        folder_paths TEXT, folder_paths_order TEXT, created_at TEXT)`
    );
    for (const t of threads) {
      const dataType = t.dataType ?? 'json';
      const data = t.data ?? new Uint8Array(Buffer.from(JSON.stringify(t.payload ?? {}), 'utf-8'));
      db.run(
        `INSERT INTO threads (id, summary, updated_at, data_type, data, parent_id, folder_paths, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          t.summary ?? '',
          t.updatedAt ?? '2026-01-01T00:00:00Z',
          dataType,
          data,
          t.parentId ?? null,
          t.folderPaths ?? null,
          t.createdAt ?? '2026-01-01T00:00:00Z',
        ]
      );
    }
  } finally {
    db.close();
  }
}
