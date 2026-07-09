## ADDED Requirements

### Requirement: Permanent Daily Rollup Persistence

The telemetry backend SHALL, on a daily schedule, aggregate the previous day's
usage events from Analytics Engine into day-grained rows in a durable rollup
store, so that adoption data survives beyond the Analytics Engine retention
window. Each rollup row SHALL be keyed by the tuple (date, command, version, os,
node_version) and SHALL carry a sampling-accurate event count and an approximate
distinct-user count. Re-running the aggregation for a date SHALL replace, not
duplicate, that date's rows (idempotent UPSERT on the key tuple).

#### Scenario: Daily aggregation writes rollup rows

- **WHEN** the scheduled rollup runs for a given day
- **THEN** the rollup store contains one row per distinct (command, version, os,
  node_version) tuple observed that day, each with the day's event count and
  approximate distinct-user count

#### Scenario: Re-running a day does not double-count

- **WHEN** the rollup for a date that already has rows is run again
- **THEN** that date's rows are replaced in place and no counts are duplicated

#### Scenario: Rollup store holds only aggregate counts

- **WHEN** a rollup row is written
- **THEN** it contains only the date, the command/version/os/node_version
  dimensions, and aggregate counts — and no `distinctId`, IP address, path,
  argument, or project identifier

#### Scenario: Rollup failure does not affect ingest

- **WHEN** the scheduled rollup fails (for example the SQL API is unavailable)
- **THEN** the public ingest path continues to accept events unaffected, and the
  failed rollup can be retried on the next schedule without data loss

### Requirement: One-Time Historical Backfill

The telemetry backend SHALL provide a maintainer-only operation that aggregates
all history currently retained in Analytics Engine into the rollup store, so the
permanent store has no gap for data collected before daily rollups began. The
backfill SHALL be idempotent with the daily rollup (same key tuple, UPSERT) so
it can be run repeatedly without duplicating counts.

#### Scenario: Backfill populates historical rollup rows

- **WHEN** an authenticated maintainer invokes the backfill operation
- **THEN** the rollup store is populated with day-grained aggregate rows for
  every day of history still present in Analytics Engine

#### Scenario: Backfill requires a valid maintainer identity

- **WHEN** the backfill operation is invoked without a valid Cloudflare Access
  identity
- **THEN** the request is denied and no aggregation runs

#### Scenario: Backfill is idempotent

- **WHEN** the backfill operation is run more than once, or overlaps a daily
  rollup for the same dates
- **THEN** the affected rollup rows are replaced in place and counts are not
  duplicated

### Requirement: Two-Layer Aggregate Query

The telemetry backend's aggregate reads SHALL draw from a hot layer (Analytics
Engine, for windows within its retention) and a cold layer (the durable rollup
store, for windows extending beyond that retention or covering all history), and
SHALL annotate each aggregate response with the layer that produced it, so a
maintainer can tell whether numbers are fine-grained recent data or day-grained
historical aggregates.

#### Scenario: Recent window served from the hot layer

- **WHEN** an aggregate is requested for a window within the Analytics Engine
  retention (for example the last 7 or 30 days)
- **THEN** the result is computed from Analytics Engine and annotated with a hot
  data source

#### Scenario: All-history window served from the cold layer

- **WHEN** an aggregate is requested for all history or a window extending past
  the Analytics Engine retention
- **THEN** the result is computed from the durable rollup store and annotated
  with a cold data source

#### Scenario: Cold layer read requires no identifiers

- **WHEN** an aggregate is served from the cold layer
- **THEN** it is derived only from stored aggregate counts, with no per-user or
  per-request identifier involved
