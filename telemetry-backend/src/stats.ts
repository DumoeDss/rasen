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

const ACCOUNT_ID = '5cc51d8388c780c03fb4c6161bd403c4';
const SQL_API_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`;
const DATASET = 'openspec_telemetry';

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
const EVENTS = 'SUM(_sample_interval) AS events';
const USERS = 'count(DISTINCT index1) AS users';

async function windowTotals(env: StatsEnv, days: number): Promise<SqlResult> {
  return runSql(
    env,
    `SELECT ${EVENTS}, ${USERS} FROM ${DATASET} WHERE timestamp > NOW() - INTERVAL '${days}' DAY`
  );
}

// --- handlers ------------------------------------------------------------

async function overview(env: StatsEnv): Promise<Response> {
  const [d1, d7] = await Promise.all([windowTotals(env, 1), windowTotals(env, 7)]);
  if (!d1.ok) return sqlErrorResponse(d1);
  if (!d7.ok) return sqlErrorResponse(d7);
  const row = (r: SqlResult & { ok: true }) => r.rows[0] ?? {};
  return json({
    last24h: { events: num(row(d1).events), users: num(row(d1).users) },
    last7d: { events: num(row(d7).events), users: num(row(d7).users) },
    usersApproximate: true,
  });
}

async function dau(env: StatsEnv, days: number): Promise<Response> {
  const res = await runSql(
    env,
    `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, ${EVENTS}, ${USERS} ` +
      `FROM ${DATASET} WHERE timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY day ORDER BY day`
  );
  if (!res.ok) return sqlErrorResponse(res);
  return json({
    days,
    series: res.rows.map((r) => ({ day: str(r.day), events: num(r.events), users: num(r.users) })),
    usersApproximate: true,
  });
}

async function breakdown(
  env: StatsEnv,
  column: 'blob1' | 'blob2',
  label: 'command' | 'version',
  days: number
): Promise<Response> {
  const res = await runSql(
    env,
    `SELECT ${column} AS ${label}, ${EVENTS}, ${USERS} FROM ${DATASET} ` +
      `WHERE timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY ${label} ORDER BY events DESC LIMIT 100`
  );
  if (!res.ok) return sqlErrorResponse(res);
  return json({
    days,
    items: res.rows.map((r) => ({ [label]: str(r[label]), events: num(r.events), users: num(r.users) })),
    usersApproximate: true,
  });
}

/**
 * Route /api/admin/* to a stats handler. Assumes the caller has already passed
 * the Access gate. Returns JSON in all cases (200 or a clean 4xx/5xx).
 */
export async function handleAdminApi(url: URL, env: StatsEnv): Promise<Response> {
  const sub = url.pathname.replace(/^\/api\/admin\/?/, '');
  const days = clampDays(url.searchParams.get('days'));
  switch (sub) {
    case 'overview':
      return overview(env);
    case 'dau':
      return dau(env, days);
    case 'commands':
      return breakdown(env, 'blob1', 'command', days);
    case 'versions':
      return breakdown(env, 'blob2', 'version', days);
    default:
      return json({ error: 'not_found' }, 404);
  }
}
