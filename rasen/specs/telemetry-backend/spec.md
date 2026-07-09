# telemetry-backend Specification

## Purpose
Ingest anonymous OpenSpec CLI usage events into a Cloudflare Analytics Engine dataset via a standalone Worker, so maintainers can measure adoption (daily active users, per-command and per-version breakdowns) while persisting only non-identifying data and never blocking the CLI.
## Requirements
### Requirement: Anonymous Usage Event Ingestion

The telemetry backend SHALL expose an HTTP endpoint that accepts a `POST` request carrying a single anonymous usage event as JSON with fields `command`, `version`, and `distinctId`, plus optional `os` and `node_version`, and SHALL respond with a 2xx status quickly so the calling CLI is never blocked.

#### Scenario: Well-formed event is accepted

- **WHEN** a client sends `POST` with body `{ "command": "init", "version": "0.1.0", "distinctId": "<uuid>" }`
- **THEN** the endpoint responds with a 2xx status and the event is recorded

#### Scenario: Optional environment fields are accepted

- **WHEN** a client includes `os` and `node_version` alongside the required fields
- **THEN** the endpoint accepts them and records them with the event

#### Scenario: Fast return

- **WHEN** the endpoint receives a valid event
- **THEN** it returns without waiting on any slow downstream work, so a CLI awaiting the response is not delayed beyond a short timeout

### Requirement: Minimal Validation

The telemetry backend's **ingest endpoint** (`POST /`) SHALL reject malformed requests with a 4xx status and SHALL only accept the documented HTTP method for ingestion, so that garbage input is not persisted. This rule scopes to the ingest endpoint only; the authenticated admin routes (`/admin*`, `/api/admin*`) are governed by the `telemetry-admin-console` capability and are not subject to the POST-only ingest rule.

#### Scenario: Missing required field is rejected

- **WHEN** an ingest request omits `command`, `version`, or `distinctId`
- **THEN** the endpoint responds with a 4xx status and records nothing

#### Scenario: Non-POST method on the ingest endpoint is rejected

- **WHEN** a request to the ingest endpoint (`/`) uses a method other than `POST` (for example `GET`)
- **THEN** the endpoint responds with a non-2xx status and records nothing

#### Scenario: Unexpected fields are not persisted

- **WHEN** an ingest request includes fields beyond the documented contract (for example a file path or arguments)
- **THEN** those fields are ignored and never written to storage

### Requirement: Privacy Contract Enforcement

The telemetry backend SHALL persist only `command`, `version`, the anonymous `distinctId`, and the optional `os`/`node_version`, and SHALL NOT store IP addresses, file paths, command arguments, or project information.

#### Scenario: Only contract fields are stored

- **WHEN** an event is persisted
- **THEN** the stored record contains only command, version, anonymous distinctId, and optional os/node_version — and no IP address, path, argument, or project identifier

#### Scenario: Anonymous identifier only

- **WHEN** an event is stored
- **THEN** the only user identifier is the client-supplied anonymous UUID, which carries no personal information

### Requirement: Analytics Engine Persistence

The telemetry backend SHALL write each accepted event as one data point to a Cloudflare Analytics Engine dataset, structured so that events can be aggregated by command and version and counted by distinct anonymous user.

#### Scenario: Event becomes an Analytics Engine data point

- **WHEN** a valid event is accepted
- **THEN** a single data point is written to the configured Analytics Engine dataset, with command/version/os/node_version available as fields and the anonymous distinctId available for distinct-user counting

### Requirement: Deployed and Reachable Endpoint

The telemetry backend SHALL be deployable as a Cloudflare Worker under the maintainer's account and, once deployed, SHALL respond successfully to a synthetic test event so the client (sibling change) can rely on a known-good endpoint URL.

#### Scenario: Deployed Worker accepts a test event

- **WHEN** a synthetic event is POSTed to the deployed Worker URL
- **THEN** the Worker responds with a 2xx status

#### Scenario: Endpoint URL is recorded for the client

- **WHEN** the Worker is deployed and verified
- **THEN** its endpoint URL is recorded in the change notes so the telemetry client change can point at it

### Requirement: Aggregate Query Access

The telemetry backend's dataset SHALL be queryable for aggregate usage analytics via the Cloudflare SQL API, and the project SHALL document the query patterns for daily-active-users and per-command/per-version breakdowns.

#### Scenario: DAU and breakdown queries are documented

- **WHEN** a maintainer reads the backend project documentation
- **THEN** it describes SQL API queries using `count()` and `count(DISTINCT distinctId)` for daily active users and `GROUP BY` command/version for breakdowns, and notes that SQL-API reads require a separate API token

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

### Requirement: Production Endpoint TLS and End-to-End Reachability

The production telemetry endpoint served at the maintainer's custom domain (`https://telemetry.rasen.io`) — the URL the shipped CLI targets — SHALL terminate TLS with a valid certificate and accept CLI-emitted events end-to-end, returning a 2xx (202) to a well-formed event. The release process SHALL verify this and record the evidence. Because TLS certificate provisioning is an external Cloudflare dependency, if provisioning is not yet complete at verification time the verification obligation SHALL be satisfied by probing and recording the pending status rather than by blocking on Cloudflare's timeline.

#### Scenario: Production endpoint serves valid TLS

- **WHEN** the production endpoint is probed over HTTPS
- **THEN** the TLS handshake completes against a valid, non-expired certificate for `telemetry.rasen.io`
- **AND** the probe transcript (certificate issuer/validity and HTTP status) is recorded as verification evidence

#### Scenario: Well-formed event is accepted end-to-end

- **WHEN** a well-formed event (`command`, `version`, `distinctId`, and optional `os`/`node_version`) is POSTed to the production endpoint
- **THEN** the endpoint responds with a 202
- **AND** a real CLI-emitted event (a genuine `rasen` command run with telemetry enabled) completes without surfacing a network error and without delaying CLI exit beyond the client timeout

#### Scenario: TLS provisioning incomplete is recorded, not blocking

- **WHEN** the production endpoint's TLS certificate is still provisioning at verification time
- **THEN** the verification records the endpoint status as a known pending external dependency (with the probe result) and does not block the change
- **AND** the client's fire-and-forget design means events are silently dropped in the interim without affecting the CLI, and dashboard confirmation that events land is left as the maintainer's follow-up step

