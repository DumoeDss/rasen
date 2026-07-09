/**
 * Read-only aggregate stats for the admin console, via the Cloudflare SQL API.
 *
 * The Analytics Engine binding is write-only, so reads go through the SQL API:
 * POST .../analytics_engine/sql with a Bearer token (secret TELEMETRY_SQL_TOKEN,
 * Account Analytics Read scope) and the SQL as a text/plain body.
 *
 * Column map for the openspec_telemetry dataset:
 *   blob1 = command, blob2 = version, blob3 = os, blob4 = node_version,
 *   index1 = distinctId, timestamp = ingest time.
 *
 * Event counts use SUM(_sample_interval) (sampling-accurate). Distinct-user
 * counts use count(DISTINCT index1) and are flagged approximate (sampling makes
 * distinct counts approximate).
 */

// Cold-layer binding type. Type-only import — erased at build time, so there is
// no runtime import cycle with rollups.ts (which imports runSql/DATASET here).
import type { RollupsEnv } from './rollups';
import { HOT_HYGIENE_PREDICATE, coldHygienePredicate } from './filter';

const ACCOUNT_ID = '5cc51d8388c780c03fb4c6161bd403c4';
const SQL_API_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`;
export const DATASET = 'openspec_telemetry';

const DEFAULT_DAYS = 14;
const MAX_DAYS = 30;

export interface StatsEnv {
  TELEMETRY_SQL_TOKEN?: string;
}

type SqlRow = Record<string, unknown>;
type SqlResult =
  | { ok: true; rows: SqlRow[] }
  | { ok: false; kind: 'token_missing' }
  | { ok: false; kind: 'upstream'; status: number; detail: string };

/** POST a SQL query to the CF SQL API. Never throws; returns a discriminated result. */
export async function runSql(env: StatsEnv, sql: string): Promise<SqlResult> {
  if (!env.TELEMETRY_SQL_TOKEN) {
    return { ok: false, kind: 'token_missing' };
  }
  let resp: Response;
  try {
    resp = await fetch(SQL_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TELEMETRY_SQL_TOKEN}`,
        'content-type': 'text/plain',
      },
      body: sql,
    });
  } catch {
    return { ok: false, kind: 'upstream', status: 0, detail: 'network error contacting SQL API' };
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    return { ok: false, kind: 'upstream', status: resp.status, detail: detail.slice(0, 500) };
  }
  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, kind: 'upstream', status: resp.status, detail: 'unparseable SQL API response' };
  }
  const data = (json as { data?: unknown })?.data;
  return { ok: true, rows: Array.isArray(data) ? (data as SqlRow[]) : [] };
}

// --- helpers -------------------------------------------------------------

function clampDays(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Map a SQL failure to a clean HTTP response — never a crash / 500.
function sqlErrorResponse(err: Exclude<SqlResult, { ok: true }>): Response {
  if (err.kind === 'token_missing') {
    return json(
      {
        error: 'stats_unconfigured',
        hint: 'TELEMETRY_SQL_TOKEN is not set. Create an Account Analytics Read API token and run `wrangler secret put TELEMETRY_SQL_TOKEN` (see RUNBOOK.md).',
      },
      503
    );
  }
  // Upstream SQL API error: 5xx (or network) → 503, auth/other 4xx → 502.
  const status = err.status >= 500 || err.status === 0 ? 503 : 502;
  return json(
    { error: 'stats_upstream_error', upstreamStatus: err.status, hint: err.detail || 'Cloudflare SQL API returned an error.' },
    status
  );
}

// SUM(_sample_interval) = sampling-accurate event count; count(DISTINCT index1)
// = distinct users (approximate under sampling).
export const EVENTS = 'SUM(_sample_interval) AS events';
export const USERS = 'count(DISTINCT index1) AS users';

// --- v2 request options: range (hot/cold), filters, hide-test ------------

type Layer = 'hot' | 'cold';

interface Filters {
  command?: string;
  version?: string;
  os?: string;
}

interface QueryOpts {
  layer: Layer;
  days: number; // hot-layer window (days); unused on the cold layer (all history)
  hideTest: boolean;
  filters: Filters;
}

// range → layer + window. 7d/30d/90d read the hot layer (within Analytics Engine
// retention); `all` reads the cold rollup store. Absent `range` falls back to the
// legacy clamped `days` param on the hot layer (back-compat).
const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

function resolveRange(url: URL): { layer: Layer; days: number } {
  const range = url.searchParams.get('range');
  if (range === 'all') return { layer: 'cold', days: 0 };
  if (range && RANGE_DAYS[range] !== undefined) return { layer: 'hot', days: RANGE_DAYS[range] };
  return { layer: 'hot', days: clampDays(url.searchParams.get('days')) };
}

// hideTest defaults ON (true); only an explicit false/0 includes smoke traffic.
function parseHideTest(url: URL): boolean {
  const v = url.searchParams.get('hideTest');
  return !(v === 'false' || v === '0');
}

// Injection guard: filter values are interpolated into the SQL-API text body on
// the hot layer, so reject any value carrying a quote, semicolon, backslash, or
// control character, and cap the length. (The cold layer additionally uses bound
// parameters.) An equality predicate constrains matches to real dimension values;
// an unknown value simply yields zero rows.
const FILTER_KEYS = ['command', 'version', 'os'] as const;
const FORBIDDEN_FILTER = /['";\\\x00-\x1f]/;

function parseFilters(url: URL): Filters | { error: string } {
  const f: Filters = {};
  for (const k of FILTER_KEYS) {
    const v = url.searchParams.get(k);
    if (v == null || v === '') continue;
    if (v.length > 256 || FORBIDDEN_FILTER.test(v)) return { error: `invalid filter value for ${k}` };
    f[k] = v;
  }
  return f;
}

// --- hot layer (Analytics Engine via SQL API) ----------------------------

// Extra predicates (test filter + dimension equality) for a hot-layer query.
// Values are pre-validated by parseFilters, so interpolation is safe here.
function hotWhere(opts: QueryOpts): string {
  const parts: string[] = [HOT_HYGIENE_PREDICATE];
  if (opts.hideTest) parts.push("blob2 != '0.0.0'");
  if (opts.filters.command) parts.push(`blob1 = '${opts.filters.command}'`);
  if (opts.filters.version) parts.push(`blob2 = '${opts.filters.version}'`);
  if (opts.filters.os) parts.push(`blob3 = '${opts.filters.os}'`);
  return parts.map((p) => ` AND ${p}`).join('');
}

async function hotWindowTotals(env: StatsEnv, days: number, opts: QueryOpts): Promise<SqlResult> {
  return runSql(
    env,
    `SELECT ${EVENTS}, ${USERS} FROM ${DATASET} ` +
      `WHERE timestamp > NOW() - INTERVAL '${days}' DAY${hotWhere(opts)}`
  );
}

async function overviewHot(env: StatsEnv, opts: QueryOpts): Promise<Response> {
  const [d1, d7] = await Promise.all([hotWindowTotals(env, 1, opts), hotWindowTotals(env, 7, opts)]);
  if (!d1.ok) return sqlErrorResponse(d1);
  if (!d7.ok) return sqlErrorResponse(d7);
  const row = (r: SqlResult & { ok: true }) => r.rows[0] ?? {};
  return json({
    last24h: { events: num(row(d1).events), users: num(row(d1).users) },
    last7d: { events: num(row(d7).events), users: num(row(d7).users) },
    usersApproximate: true,
    source: 'hot',
  });
}

async function dauHot(env: StatsEnv, opts: QueryOpts): Promise<Response> {
  const res = await runSql(
    env,
    `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ${EVENTS}, ${USERS} ` +
      `FROM ${DATASET} WHERE timestamp > NOW() - INTERVAL '${opts.days}' DAY${hotWhere(opts)} ` +
      `GROUP BY day ORDER BY day`
  );
  if (!res.ok) return sqlErrorResponse(res);
  return json({
    days: opts.days,
    series: res.rows.map((r) => ({ day: str(r.day), events: num(r.events), users: num(r.users) })),
    usersApproximate: true,
    source: 'hot',
  });
}

async function breakdownHot(
  env: StatsEnv,
  opts: QueryOpts,
  column: 'blob1' | 'blob2' | 'blob3',
  label: 'command' | 'version' | 'os'
): Promise<Response> {
  const res = await runSql(
    env,
    `SELECT ${column} AS ${label}, ${EVENTS}, ${USERS} FROM ${DATASET} ` +
      `WHERE timestamp > NOW() - INTERVAL '${opts.days}' DAY${hotWhere(opts)} ` +
      `GROUP BY ${label} ORDER BY events DESC LIMIT 100`
  );
  if (!res.ok) return sqlErrorResponse(res);
  return json({
    days: opts.days,
    items: res.rows.map((r) => ({ [label]: str(r[label]), events: num(r.events), users: num(r.users) })),
    usersApproximate: true,
    source: 'hot',
  });
}

// --- cold layer (D1 rollup store) ----------------------------------------
//
// NOTE ON USERS: per-day distinct-user counts are NOT additive across days
// (SUM over days over-counts returning users), so cold-layer `users` totals are
// an approximate UPPER BOUND. Events ARE additive and are the primary metric.

// Build the cold-layer WHERE clause. `base` is a trusted literal predicate (never
// user input). hideTest uses a literal; dimension filters use bound `?` params.
function coldWhere(opts: QueryOpts, base?: string): { clause: string; binds: unknown[] } {
  const parts: string[] = [];
  const binds: unknown[] = [];
  if (base) parts.push(base);
  const hygiene = coldHygienePredicate();
  parts.push(hygiene.sql);
  binds.push(...hygiene.binds);
  if (opts.hideTest) parts.push("version != '0.0.0'");
  if (opts.filters.command) {
    parts.push('command = ?');
    binds.push(opts.filters.command);
  }
  if (opts.filters.version) {
    parts.push('version = ?');
    binds.push(opts.filters.version);
  }
  if (opts.filters.os) {
    parts.push('os = ?');
    binds.push(opts.filters.os);
  }
  return { clause: parts.length ? ' WHERE ' + parts.join(' AND ') : '', binds };
}

async function coldQuery(env: RollupsEnv, sql: string, binds: unknown[]): Promise<SqlRow[] | null> {
  if (!env.ROLLUPS) return null;
  try {
    const stmt = binds.length ? env.ROLLUPS.prepare(sql).bind(...binds) : env.ROLLUPS.prepare(sql);
    const res = await stmt.all<SqlRow>();
    return res.results ?? [];
  } catch {
    return null;
  }
}

function coldUnavailable(): Response {
  return json(
    {
      error: 'cold_store_unavailable',
      hint: 'The rollup store (D1 binding ROLLUPS) is not configured or returned an error.',
    },
    503
  );
}

async function overviewCold(env: RollupsEnv, opts: QueryOpts): Promise<Response> {
  const w1 = coldWhere(opts, "date >= date('now','-1 day')");
  const w7 = coldWhere(opts, "date >= date('now','-7 day')");
  const [r1, r7] = await Promise.all([
    coldQuery(env, `SELECT SUM(events) AS events, SUM(users) AS users FROM rollups${w1.clause}`, w1.binds),
    coldQuery(env, `SELECT SUM(events) AS events, SUM(users) AS users FROM rollups${w7.clause}`, w7.binds),
  ]);
  if (r1 == null || r7 == null) return coldUnavailable();
  return json({
    last24h: { events: num(r1[0]?.events), users: num(r1[0]?.users) },
    last7d: { events: num(r7[0]?.events), users: num(r7[0]?.users) },
    usersApproximate: true,
    source: 'cold',
  });
}

async function dauCold(env: RollupsEnv, opts: QueryOpts): Promise<Response> {
  const w = coldWhere(opts);
  const rows = await coldQuery(
    env,
    `SELECT date AS day, SUM(events) AS events, SUM(users) AS users FROM rollups${w.clause} ` +
      `GROUP BY date ORDER BY date`,
    w.binds
  );
  if (rows == null) return coldUnavailable();
  return json({
    range: 'all',
    series: rows.map((r) => ({ day: str(r.day), events: num(r.events), users: num(r.users) })),
    usersApproximate: true,
    source: 'cold',
  });
}

async function breakdownCold(
  env: RollupsEnv,
  opts: QueryOpts,
  column: 'command' | 'version' | 'os'
): Promise<Response> {
  const w = coldWhere(opts);
  const rows = await coldQuery(
    env,
    `SELECT ${column} AS ${column}, SUM(events) AS events, SUM(users) AS users FROM rollups${w.clause} ` +
      `GROUP BY ${column} ORDER BY events DESC LIMIT 100`,
    w.binds
  );
  if (rows == null) return coldUnavailable();
  return json({
    range: 'all',
    items: rows.map((r) => ({ [column]: str(r[column]), events: num(r.events), users: num(r.users) })),
    usersApproximate: true,
    source: 'cold',
  });
}

/**
 * Route /api/admin/* to a stats handler. Assumes the caller has already passed
 * the Access gate. Returns JSON in all cases (200 or a clean 4xx/5xx). Selects
 * the hot (Analytics Engine) or cold (D1 rollups) layer from the `range` param,
 * applies the hide-test-traffic default and optional dimension filters, and
 * annotates each response with its `source`.
 */
export async function handleAdminApi(url: URL, env: StatsEnv & RollupsEnv): Promise<Response> {
  const sub = url.pathname.replace(/^\/api\/admin\/?/, '');
  const parsed = parseFilters(url);
  if ('error' in parsed) return json({ error: 'invalid_filter', hint: parsed.error }, 400);
  const { layer, days } = resolveRange(url);
  const opts: QueryOpts = { layer, days, hideTest: parseHideTest(url), filters: parsed };

  switch (sub) {
    case 'overview':
      return layer === 'cold' ? overviewCold(env, opts) : overviewHot(env, opts);
    case 'dau':
      return layer === 'cold' ? dauCold(env, opts) : dauHot(env, opts);
    case 'commands':
      return layer === 'cold' ? breakdownCold(env, opts, 'command') : breakdownHot(env, opts, 'blob1', 'command');
    case 'versions':
      return layer === 'cold' ? breakdownCold(env, opts, 'version') : breakdownHot(env, opts, 'blob2', 'version');
    case 'os':
      return layer === 'cold' ? breakdownCold(env, opts, 'os') : breakdownHot(env, opts, 'blob3', 'os');
    default:
      return json({ error: 'not_found' }, 404);
  }
}
