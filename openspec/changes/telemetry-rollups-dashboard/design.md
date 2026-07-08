## Context

`openspec-telemetry` is a bare Cloudflare Worker (no framework, no build step)
that ingests anonymous CLI usage into an Analytics Engine dataset
(`openspec_telemetry`) and serves an Access-gated admin console. Reads go through
the Cloudflare SQL API with the `TELEMETRY_SQL_TOKEN` secret; Analytics Engine
retains raw events for only ~90 days on a rolling window. The dataset column map
is fixed: `blob1=command`, `blob2=version`, `blob3=os`, `blob4=node_version`,
`index1=distinctId`. Event counts use `SUM(_sample_interval)`; distinct users use
`count(DISTINCT index1)` (approximate under sampling).

Current live data is ~2 days of mostly smoke-test traffic (11 fake "users", all
version `0.0.0`) plus a few real CLI events (`0.1.0`). The Worker is live at
`openspec-telemetry.ws11579.workers.dev` (public ingest) and `telemetry.rasen.io`
(custom domain, Access-gated `/admin*`). Existing tests inject an in-memory RS256
JWKS via `ACCESS_URLS.keySet` and stub the SQL API through global `fetch`.

This change adds permanent day-grained storage (D1) fed by a daily cron, a
one-time backfill, a two-layer read path, and a richer single-file dashboard —
all as pure additions that leave the ingest hot path and Access gate untouched.

## Goals / Non-Goals

**Goals:**
- Persist telemetry permanently as day-grained aggregates in D1 before Analytics
  Engine expires it, storing only aggregate counts (never `distinctId`).
- Idempotent daily rollup (cron) and a one-time historical backfill, both keyed
  on (date, command, version, os, node_version).
- Stats API selects hot (Analytics Engine, ≤ retention) vs. cold (D1, all
  history) layer per requested window and annotates the source.
- Dashboard v2: time range (7d/30d/90d/all), command/version/os filters,
  hide-test-traffic toggle (default ON), richer charts — single no-build file.

**Non-Goals:**
- No change to the ingest hot path (`POST /`), its latency, or its contract.
- No change to the Access/JWT enforcement layer (`src/access.ts`) or the
  `workers.dev` route or the load-bearing assets flags.
- No ORM / query-builder dependency — hand-written SQL only (zero new deps).
- No per-user analytics; no storage of any identifier in D1.
- No move to a bundled/SPA admin unless single-file complexity truly blows up
  (not expected for this scope).

## Decisions

### D1 as the cold store, one row per (date × dimensions)

Create one D1 database (`wrangler d1 create rasen-telemetry-rollups`), bound as
`ROLLUPS`. Schema:

```sql
CREATE TABLE IF NOT EXISTS rollups (
  date         TEXT NOT NULL,   -- 'YYYY-MM-DD' (UTC day)
  command      TEXT NOT NULL,
  version      TEXT NOT NULL,
  os           TEXT NOT NULL,
  node_version TEXT NOT NULL,
  events       INTEGER NOT NULL,
  users        INTEGER NOT NULL,  -- approximate (sampled distinct)
  PRIMARY KEY (date, command, version, os, node_version)
);
```

Idempotency comes from the composite PK plus
`INSERT ... ON CONFLICT(date,command,version,os,node_version) DO UPDATE SET
events=excluded.events, users=excluded.users`. A cron rerun or a backfill
overlapping the same day replaces counts in place — never double-counts.
`NULL`/empty dimension values are normalized to `''` on write so the PK is
stable (Analytics Engine returns empty strings for absent blobs). Rationale for
D1 over KV/R2: we need grouped/filtered SQL aggregation across all history, which
is exactly a relational read; D1's SQLite gives GROUP BY / SUM directly. Chose
hand-written SQL over drizzle (used in elftia) to keep the Worker zero-build and
zero-dependency, consistent with the existing codebase.

### Scheduled handler aggregates yesterday from Analytics Engine → D1

Add a `scheduled(event, env, ctx)` export alongside `fetch`. Cron
`"0 1 * * *"` (01:00 UTC, after the UTC day closes) runs one SQL API query
grouping the prior UTC day by all four dimensions:

```sql
SELECT blob1 AS command, blob2 AS version, blob3 AS os, blob4 AS node_version,
       SUM(_sample_interval) AS events, count(DISTINCT index1) AS users
FROM openspec_telemetry
WHERE timestamp >= toStartOfDay(NOW() - INTERVAL '1' DAY)
  AND timestamp <  toStartOfDay(NOW())
GROUP BY command, version, os, node_version
```

Rows are UPSERTed into D1 in a batched write (`env.ROLLUPS.batch([...])`) with
the date bound to the aggregated day. The rollup path reuses the existing
`runSql()` helper in `stats.ts` (already returns a discriminated result, never
throws), so a SQL API failure is a clean no-op that retries next cron. The
scheduled handler is a pure bypass: it shares no code with `handleIngest`.

### One-time backfill as a protected admin endpoint

Add `POST /api/admin/backfill` routed inside the existing `/api/admin/*` branch
in `fetch`, so it inherits `verifyAdminAccess` (fail-closed) with zero new auth
code. It aggregates all retained history grouped by **day and dimensions** in one
query (`toStartOfDay(timestamp) AS date ... GROUP BY date, command, ...`) and
UPSERTs every returned row. Because it shares the key tuple and UPSERT with the
daily rollup, it is safe to run repeatedly and safe to overlap the cron. Chose an
admin endpoint over a deploy-time script so it runs with the already-provisioned
SQL token/binding in the Worker runtime and needs no local wrangler auth dance.
Returns a JSON summary (days processed, rows written).

### Stats API v2 — hot/cold selection + source annotation + test filter

`handleAdminApi` gains a `range` parameter (`7d|30d|90d|all`, superseding the raw
`days` clamp for v2 callers; `days` stays accepted for back-compat). Selection
rule: ranges within Analytics Engine retention (7d/30d/90d) read the **hot**
layer via the existing SQL-API queries; `all` reads the **cold** layer from D1.
Every response gains `source: "hot" | "cold"` (and keeps `usersApproximate`).
A `hideTest` flag (default true) adds `AND blob2 != '0.0.0'` on the hot layer and
`AND version != '0.0.0'` on the cold layer. Dimension filters (`command`,
`version`, `os`) add equality predicates on the matching column/field on
whichever layer serves the request. All filter values are validated/escaped
before interpolation (the codebase interpolates SQL as text; keep values
constrained to the known dimension set and reject stray quotes) to avoid
injection into the SQL-API body.

### Dashboard v2 stays a single no-build file

Extend `admin/index.html` in place: a control bar (time-range `<select>`,
command/version/os filter `<select>`s populated from the breakdown responses, a
hide-test-traffic checkbox defaulting checked), a source badge reflecting the
`source` field, and the existing inline-SVG chart extended to a stacked/trend
view. All state lives in `load()` query params; no framework, no bundler — honors
the locked single-file constraint. If (and only if) complexity forces a build,
that decision must be justified separately; current scope does not require it.

## Risks / Trade-offs

- **D1 create needs the `d1` OAuth scope** → if `wrangler d1 create` fails on a
  missing scope, do NOT retry blindly: report the exact error and add "create the
  database in the Cloudflare dashboard, then paste `database_id` into
  `wrangler.toml`" as a RUNBOOK step. Binding + schema still apply the same way.
- **Cold-layer distinct-user counts are not additive across days** → summing
  per-day `users` over-counts returning users. Mitigation: label cold-layer
  distinct-user totals approximate (already the sampling caveat) and, where a
  single number is shown, present per-day series or events (which ARE additive)
  as the primary metric; document that all-history "users" is an upper bound.
- **UTC day boundary vs. cron time** → aggregating `[startOfDay(-1), startOfDay)`
  at 01:00 UTC guarantees the target day is fully closed; late-arriving events
  are negligible for anonymous CLI telemetry. Idempotent UPSERT lets a re-run
  correct any day.
- **SQL injection via filter values** → interpolated into the SQL-API text body;
  mitigation: constrain dimension filters to values present in the dataset's own
  breakdown responses and reject any value containing quote/semicolon characters
  before building the query.
- **Cron double-fire / overlap with backfill** → composite PK + UPSERT makes both
  idempotent; no locking needed.
- **Privacy regression risk in the new store** → mitigation: the rollup queries
  select only dimensions + aggregate functions (never `index1` as a stored
  value), and a test asserts no `distinctId`/identifier column exists in D1 rows.

## Migration Plan

1. `wrangler d1 create rasen-telemetry-rollups` → capture `database_id`.
2. Add `[[d1_databases]]` (binding `ROLLUPS`) and `[triggers] crons = ["0 1 * * *"]`
   to `wrangler.toml`; apply schema via `wrangler d1 execute` (migration SQL file).
3. `wrangler deploy` (adds the `scheduled` handler + backfill route + stats v2).
4. Invoke `POST /api/admin/backfill` once (authenticated) to seed all history.
5. Verify: cron rollup writes rows (`wrangler dev --test-scheduled` or wait one
   cycle), D1 has rows (`wrangler d1 execute --command "SELECT count(*)..."`),
   ingest still `202`, `/admin` unauth still `403`, panel filters/ranges/toggle
   behave. **Rollback**: revert the deploy; the D1 database and rows are inert if
   unread, and the ingest path is unaffected by the presence/absence of `ROLLUPS`.

Delivery is **local commit only** (no push). Every commit MUST use an explicit
pathspec (`git commit -F <msgfile> -- <paths>`) because a parallel rename session
shares this working tree/index; a bare commit would swallow its staged files.

## Open Questions

- Exact retention threshold for hot vs. cold when a future range sits partly
  inside and partly outside the AE window — v2 only exposes discrete 7d/30d/90d
  (hot) and all (cold), so no split-window query is needed yet; revisit if a
  custom-range picker is added.
