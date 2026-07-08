/**
 * Cold-store rollups: aggregate Analytics Engine data into day-grained rows in
 * D1 (binding `ROLLUPS`) so it survives past the ~90-day rolling window.
 *
 * Privacy contract (hard line): only aggregate counts per
 * (date, command, version, os, node_version) are ever written — NEVER index1 /
 * distinctId. The queries below select dimensions + aggregate functions only.
 *
 * Idempotency: the composite primary key + UPSERT means a cron re-run or a
 * backfill overlapping the same day replaces counts in place rather than
 * double-counting. Both the daily rollup and the one-time backfill share the key
 * tuple and the same UPSERT, so they are safe to overlap and safe to repeat.
 */
import { runSql, DATASET, EVENTS, USERS, type StatsEnv } from './stats';

// --- minimal D1 binding surface (hand-written, no @cloudflare/workers-types dep) ---

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = unknown>(colName?: string): Promise<T | null>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

/** Env slice carrying the D1 cold store. Shared by the rollup writer and the
 *  cold-layer stats reader. */
export interface RollupsEnv {
  ROLLUPS?: D1Database;
}

// --- helpers -------------------------------------------------------------

/** Analytics Engine returns '' for absent blobs; normalize any nullish/other
 *  value to a stable string so the composite PK never varies. */
function dim(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function intOf(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** 'YYYY-MM-DD' for a UTC date. */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Epoch ms at the start (00:00:00) of the UTC day containing `ms`. */
function startOfUtcDayMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const UPSERT_SQL =
  'INSERT INTO rollups (date, command, version, os, node_version, events, users) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
  'ON CONFLICT(date, command, version, os, node_version) ' +
  'DO UPDATE SET events = excluded.events, users = excluded.users';

/** A rollup row ready to persist. Deliberately has no identifier field. */
export interface RollupRow {
  date: string;
  command: string;
  version: string;
  os: string;
  node_version: string;
  events: number;
  users: number;
}

/** UPSERT a batch of rollup rows into D1. No-op on an empty batch. */
async function upsertRows(db: D1Database, rows: RollupRow[]): Promise<void> {
  if (rows.length === 0) return;
  const stmts = rows.map((r) =>
    db
      .prepare(UPSERT_SQL)
      .bind(r.date, r.command, r.version, r.os, r.node_version, r.events, r.users)
  );
  await db.batch(stmts);
}

// --- daily rollup --------------------------------------------------------

/**
 * Aggregate one UTC day from Analytics Engine and UPSERT it into D1.
 *
 * With no `day`, aggregates the prior UTC day (the cron runs at 01:00 UTC, after
 * that day has closed). `day` ('YYYY-MM-DD') overrides the target day.
 *
 * A missing SQL token or an upstream SQL API failure is a clean no-op (runSql
 * never throws) — the next cron re-runs the same day idempotently. Returns a
 * summary; `rows` is the number of dimension tuples written.
 */
export async function runDailyRollup(
  env: StatsEnv & RollupsEnv,
  day?: string
): Promise<{ ok: boolean; date: string; rows: number }> {
  const now = Date.now();
  const targetDay = day ?? utcDay(new Date(now - 24 * 60 * 60 * 1000));
  const date = targetDay;

  // Express the day window with only NOW()/INTERVAL/toStartOfDay — the SQL subset
  // the Analytics Engine SQL API is known to accept (same functions as stats.ts).
  // daysAgo = whole UTC days between the target day and today; the default cron
  // case (yesterday) is daysAgo=1, giving exactly the design's
  // [toStartOfDay(NOW()-1 DAY), toStartOfDay(NOW())) window.
  const daysAgo = Math.round((startOfUtcDayMs(now) - Date.parse(`${targetDay}T00:00:00Z`)) / (24 * 60 * 60 * 1000));
  const lo = daysAgo;
  const hi = daysAgo - 1;
  const sql =
    `SELECT blob1 AS command, blob2 AS version, blob3 AS os, blob4 AS node_version, ` +
    `${EVENTS}, ${USERS} FROM ${DATASET} ` +
    `WHERE timestamp >= toStartOfDay(NOW() - INTERVAL '${lo}' DAY) ` +
    `AND timestamp < toStartOfDay(NOW() - INTERVAL '${hi}' DAY) ` +
    `GROUP BY command, version, os, node_version`;

  const res = await runSql(env, sql);
  if (!res.ok) return { ok: false, date, rows: 0 };
  if (!env.ROLLUPS) return { ok: false, date, rows: 0 };

  const rows: RollupRow[] = res.rows.map((r) => ({
    date,
    command: dim(r.command),
    version: dim(r.version),
    os: dim(r.os),
    node_version: dim(r.node_version),
    events: intOf(r.events),
    users: intOf(r.users),
  }));
  await upsertRows(env.ROLLUPS, rows);
  return { ok: true, date, rows: rows.length };
}

// --- one-time historical backfill ---------------------------------------

/**
 * Aggregate ALL retained Analytics Engine history grouped by day + dimensions
 * and UPSERT every row. Shares the key tuple + UPSERT with the daily rollup, so
 * it is safe to run repeatedly and safe to overlap the cron. Returns
 * `{ days, rows }`.
 */
export async function runBackfill(
  env: StatsEnv & RollupsEnv
): Promise<{ ok: boolean; days: number; rows: number }> {
  const sql =
    `SELECT toStartOfDay(timestamp) AS day, ` +
    `blob1 AS command, blob2 AS version, blob3 AS os, blob4 AS node_version, ` +
    `${EVENTS}, ${USERS} FROM ${DATASET} ` +
    `GROUP BY day, command, version, os, node_version ORDER BY day`;

  const res = await runSql(env, sql);
  if (!res.ok) return { ok: false, days: 0, rows: 0 };
  if (!env.ROLLUPS) return { ok: false, days: 0, rows: 0 };

  const days = new Set<string>();
  const rows: RollupRow[] = res.rows.map((r) => {
    // AE returns the day as a datetime string ('YYYY-MM-DD HH:MM:SS'); keep the date.
    const date = dim(r.day).slice(0, 10);
    days.add(date);
    return {
      date,
      command: dim(r.command),
      version: dim(r.version),
      os: dim(r.os),
      node_version: dim(r.node_version),
      events: intOf(r.events),
      users: intOf(r.users),
    };
  });
  await upsertRows(env.ROLLUPS, rows);
  return { ok: true, days: days.size, rows: rows.length };
}
