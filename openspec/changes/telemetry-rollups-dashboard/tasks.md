## 1. D1 rollup store & config

- [x] 1.1 Run `wrangler d1 create rasen-telemetry-rollups` from `telemetry-backend/`; capture `database_id`. If it fails on a missing `d1` OAuth scope, do NOT retry blindly — record the exact error and add a RUNBOOK step to create the DB in the Cloudflare dashboard, then continue with the returned/dashboard `database_id`. (Succeeded: database_id `6ef1574a-b82c-4433-aab4-9d719ad4524b`, region APAC.)
- [x] 1.2 Add `[[d1_databases]]` (binding `ROLLUPS`, `database_name`, `database_id`) to `wrangler.toml`. Do NOT touch `workers_dev`, `routes`, `[assets]` flags (`run_worker_first`/`not_found_handling`/`html_handling`), or `[vars]`.
- [x] 1.3 Add `[triggers] crons = ["0 1 * * *"]` (01:00 UTC daily) to `wrangler.toml`.
- [x] 1.4 Add a migration SQL file (e.g. `telemetry-backend/migrations/0001_rollups.sql`) creating the `rollups` table with PK `(date, command, version, os, node_version)` and `events`/`users` INTEGER columns.

## 2. Rollup aggregation module

- [x] 2.1 Create `src/rollups.ts`: export `runDailyRollup(env, day?)` that queries the prior UTC day from Analytics Engine grouped by command/version/os/node_version (SUM(_sample_interval), count(DISTINCT index1)) via the existing `runSql()` helper, normalizes empty dimensions to `''`, and UPSERTs rows into `ROLLUPS` via `INSERT ... ON CONFLICT(...) DO UPDATE`. Never store `index1`/distinctId — only aggregate counts.
- [x] 2.2 In `src/rollups.ts`, export `runBackfill(env)` that aggregates ALL retained history grouped by `toStartOfDay(timestamp) AS date` + dimensions and UPSERTs every day/dimension row (same key tuple + UPSERT ⇒ idempotent). Return a summary `{ days, rows }`.
- [x] 2.3 Define the `ROLLUPS` D1 binding type in the `Env` interface (`src/index.ts`) and a shared `RollupsEnv` type; keep zero new npm dependencies (hand-written SQL, no ORM).

## 3. Worker wiring (scheduled + backfill route)

- [x] 3.1 Add a `scheduled(event, env, ctx)` export in `src/index.ts` that calls `runDailyRollup(env)` inside `ctx.waitUntil(...)`. It must be a pure bypass — no shared code with `handleIngest`, zero change to the ingest hot path.
- [x] 3.2 Add `POST /api/admin/backfill` inside the existing `/api/admin/*` branch (AFTER `verifyAdminAccess`, so it inherits the fail-closed gate); on success return the `runBackfill` JSON summary. Reject non-POST methods on that subpath.

## 4. Stats API v2 (hot/cold + source + filters)

- [x] 4.1 In `src/stats.ts`, add a `range` param (`7d|30d|90d|all`) to `handleAdminApi`; keep the existing `days` clamp accepted for back-compat. Map 7d/30d/90d → hot layer, `all` → cold layer.
- [x] 4.2 Add cold-layer query functions that read `ROLLUPS` (overview totals, per-day series, per-command/per-version breakdowns) using SUM(events); label all-history distinct-user totals approximate/upper-bound (per-day users are not additive).
- [x] 4.3 Annotate every stats response with `source: "hot" | "cold"` alongside `usersApproximate`.
- [x] 4.4 Add a `hideTest` flag (default true) → `blob2 != '0.0.0'` (hot) / `version != '0.0.0'` (cold); add optional `command`/`version`/`os` dimension filters as equality predicates on the serving layer.
- [x] 4.5 Validate/escape filter values before interpolation — constrain to the known dimension set and reject values containing quote/semicolon characters (SQL text-body injection guard).

## 5. Dashboard v2 (single no-build file)

- [x] 5.1 In `admin/index.html`, add a control bar: time-range `<select>` (7d/30d/90d/all), command/version/os filter `<select>`s (populated from breakdown responses), and a hide-test-traffic checkbox defaulting checked.
- [x] 5.2 Thread the controls into `load()` as query params (`range`, `command`, `version`, `os`, `hideTest`) and re-fetch on change/refresh.
- [x] 5.3 Render a data-source badge from the `source` field (recent live vs. historical aggregates) and extend the SVG chart to the richer trend/stacked view. Keep it a single self-contained file — no bundler, no new asset files. (Dual-series events+users trend; a true dimension-stacked chart would need a per-dimension per-day endpoint, out of scope.)

## 6. Tests (vitest)

- [x] 6.1 Rollup aggregation: mock the SQL API response (via the existing global-fetch stub) and a mock/in-memory `ROLLUPS` binding; assert `runDailyRollup` writes one UPSERT row per dimension tuple with correct events/users and NO identifier field.
- [x] 6.2 UPSERT idempotency: run the rollup twice for the same day against the mock binding; assert rows are replaced, counts not doubled.
- [x] 6.3 Backfill: assert `runBackfill` groups by day+dimensions and UPSERTs every row; assert it requires a valid Access identity via `POST /api/admin/backfill` (403 without JWT, 200 summary with valid JWT).
- [x] 6.4 Hot/cold selection: `range=90d` hits Analytics Engine (asserts SQL API body) and returns `source:"hot"`; `range=all` reads the mock `ROLLUPS` and returns `source:"cold"`.
- [x] 6.5 Test-traffic filter: `hideTest` default excludes `0.0.0` on both layers (assert the predicate in the hot SQL body and in the cold query path).
- [x] 6.6 Regression: keep the existing ingest 202 / 400 / 405 and fail-closed admin 403 tests green (do not weaken them). (All 13 original tests still green; suite now 29 tests.)

## 7. Deploy & live verification

- [x] 7.1 Apply the migration: `wrangler d1 execute rasen-telemetry-rollups --file migrations/0001_rollups.sql` (and `--local` first if iterating). (Applied `--remote`; table created, success.)
- [x] 7.2 `wrangler deploy` (from `telemetry-backend/`); confirm no change to the live ingest URL or Access config. (Deployed version `cac0d058-d077-4c59-a7e0-8ec4e3179f32`; both routes intact, `schedule: 0 1 * * *` registered, Access vars unchanged.)
- [~] 7.3 Trigger a rollup once (`wrangler dev --test-scheduled` locally, or wait one cron cycle) and confirm D1 has rows: `wrangler d1 execute rasen-telemetry-rollups --command "SELECT date, count(*) FROM rollups GROUP BY date"`. PARTIAL: table/binding/cron/scheduled-handler all verified (scheduled endpoint returns 200); row population NOT confirmable non-interactively — the `TELEMETRY_SQL_TOKEN` secret exists only on the deployed worker (remote `wrangler dev` preview does not carry `wrangler secret put` secrets, no `.dev.vars`, and running `wrangler secret put` is forbidden). Population occurs on the first 01:00 UTC cron or via the authenticated backfill (7.4). Aggregation/UPSERT/idempotency proven by unit tests 6.1/6.2.
- [ ] 7.4 Invoke `POST /api/admin/backfill` once (authenticated, from a browser signed into Access or an equivalent request) and confirm the summary + historical rows in D1. USER-ACTION-REQUIRED: needs a browser signed into Cloudflare Access; endpoint is deployed and gated (returns 403 unauthenticated).
- [x] 7.5 Live regressions: `POST /` → `202` (use `curl --noproxy '*'`), unauthenticated `GET /admin` → `403`/redirect. Confirm both still hold. (Live: POST / → 202, GET / → 405, GET /admin → 403, GET /api/admin/overview → 403. Note: workers.dev host must go THROUGH the proxy — `--noproxy '*'` there yields a hang/000.)
- [ ] 7.6 Panel acceptance (user hands-on): time-range switch reloads numbers, command/version/os filters narrow the view, hide-test-traffic default-on hides `0.0.0`, source badge reflects hot vs. cold. USER-ACTION-REQUIRED: needs the human at the signed-in panel.

## 8. Docs

- [x] 8.1 Update `RUNBOOK.md` with the D1 create step (incl. the dashboard fallback if the OAuth scope is missing), the migration/deploy sequence, and the one-time backfill invocation.
- [x] 8.2 Update `README.md` to document the rollup store, the daily cron, the stats v2 hot/cold layers + source annotation, and the dashboard filters.

## 9. Deliver

- [x] 9.1 Commit locally with an explicit pathspec only (`git commit -F <msgfile> -- telemetry-backend/ openspec/changes/telemetry-rollups-dashboard/`); verify with `git show --stat` that no parallel-session files were swept in. Do NOT push.
