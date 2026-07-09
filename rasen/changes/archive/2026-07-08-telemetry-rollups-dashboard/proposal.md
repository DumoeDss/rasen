## Why

Analytics Engine retains raw events for only ~90 days on a rolling window, so
the telemetry the CLI already collects is silently lost after a quarter and can
never be revisited for long-term adoption trends. Maintainers also cannot slice
the admin console by time range, dimension, or exclude their own smoke-test
traffic, so the numbers on screen are dominated by test noise and capped at the
Analytics Engine window.

This change makes telemetry permanent (daily aggregates persisted to D1 before
the Analytics Engine window expires) and turns the read-only admin panel into a
usable dashboard, without touching the privacy contract or the ingest hot path.

## What Changes

- **Daily rollups to permanent storage**: a scheduled (cron) handler aggregates
  the previous day's events from Analytics Engine (grouped by
  command/version/os/node_version) and UPSERTs day-grained rows into a new D1
  database. Only aggregate counts are stored — never any `distinctId`, IP, path,
  or argument. Reruns are idempotent via a composite primary key.
- **One-time historical backfill**: a protected admin endpoint
  (`POST /api/admin/backfill`, behind the same Access gate) aggregates all
  history currently in Analytics Engine into D1 so the cold store has no gap
  from day one.
- **Stats API v2 (hot + cold layers)**: stats endpoints select the Analytics
  Engine hot layer for windows within its retention and the D1 cold layer for
  older/all-history windows, and annotate every response with its data source.
- **Dashboard v2**: the single-file admin panel gains a time-range selector
  (7d / 30d / 90d / all-history), command/version/os dimension filters, and a
  hide-test-traffic toggle (default ON, filtering `version = '0.0.0'`), plus
  richer trend charts. It stays a no-build single file.
- The public ingest path (`POST /`), the Access/JWT enforcement layer, the
  `workers.dev` route, and the load-bearing assets flags are unchanged.

## Capabilities

### New Capabilities
<!-- none — this change extends the two existing telemetry capabilities -->

### Modified Capabilities
- `telemetry-backend`: adds a permanent daily-rollup store (scheduled
  aggregation into D1 with idempotent UPSERT), a one-time historical backfill,
  and a two-layer (hot Analytics Engine / cold D1) aggregate query contract with
  source annotation. Privacy contract (aggregate counts only, no identifiers)
  extends unchanged to the rollup store.
- `telemetry-admin-console`: extends the stats API to serve cold-layer/all-time
  windows with a data-source annotation and a test-traffic filter, and extends
  the admin panel with time-range selection, dimension filters, and a
  hide-test-traffic toggle.

## Impact

- **New system**: one Cloudflare D1 database (e.g. `rasen-telemetry-rollups`)
  bound to the Worker; a `[triggers] crons` daily schedule; a `scheduled`
  handler in `telemetry-backend/src/`.
- **Modified code**: `telemetry-backend/src/index.ts` (add `scheduled` export +
  backfill route), `src/stats.ts` (hot/cold layer selection, test-traffic
  filter, source annotation), `telemetry-backend/admin/index.html` (dashboard
  v2), `wrangler.toml` (`[[d1_databases]]` + `[triggers]`), plus new rollup
  module and vitest coverage.
- **Deploy/ops**: `wrangler d1 create`, a `wrangler.toml` change, a redeploy,
  and a one-time backfill invocation; documented in RUNBOOK.md.
- **Unchanged**: ingest hot path, privacy contract, Access enforcement,
  `workers_dev` route, and the `run_worker_first` / `not_found_handling` /
  `html_handling` assets flags.
