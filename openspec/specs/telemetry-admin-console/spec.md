# telemetry-admin-console Specification

## Purpose
Serve a private maintainer admin console from the same telemetry Worker: an Access-gated single-file panel at `/admin`, a read-only aggregate stats API under `/api/admin/*`, and fail-closed in-Worker Cloudflare Access JWT enforcement on every admin route (including on the `workers.dev` host that bypasses edge Access), with graceful degradation before the SQL read token exists and reachability at the custom domain `telemetry.rasen.io`.
## Requirements
### Requirement: Access-Gated Admin Panel Serving

The telemetry backend SHALL serve a maintainer admin panel at `/admin` from the same Worker, and SHALL serve the panel only to a request bearing a valid Cloudflare Access identity. The panel SHALL be a single self-contained document requiring no build step.

#### Scenario: Authenticated request receives the panel

- **WHEN** a request to `GET /admin` carries a valid Access identity for the configured application
- **THEN** the Worker responds `200` with the admin panel HTML

#### Scenario: Unauthenticated request never receives the panel

- **WHEN** a request to `GET /admin` (or any `/admin/*` path) arrives without a valid Access identity — including on a host that does not pass through Cloudflare Access
- **THEN** the Worker responds `403` with a static access-required notice and does NOT return the panel HTML or any asset bytes

#### Scenario: Panel served without a build chain

- **WHEN** the Worker is deployed
- **THEN** the panel is delivered as a single self-contained file with no bundler or compile step introduced to the Worker

### Requirement: Fail-Closed In-Worker Access Enforcement

The telemetry backend SHALL independently verify the Cloudflare Access JWT on every `/admin*` and `/api/admin*` request across all hosts, and SHALL deny the request when Access configuration is absent or the JWT is missing or invalid. Enforcement SHALL NOT depend on edge Access being present, because the public `workers.dev` host bypasses Access.

#### Scenario: Missing Access configuration denies all admin access

- **WHEN** an admin route is requested while the Access configuration (team domain and audience) is absent
- **THEN** the Worker denies the request (admin panel paths → `403`, admin API paths → `403`) and no admin behavior is exposed

#### Scenario: Missing or invalid JWT is rejected

- **WHEN** an admin route is requested with no `Cf-Access-Jwt-Assertion` header, or with a token whose signature, audience, issuer, or expiry does not validate against the configured Access application
- **THEN** the Worker denies the request without serving the panel or stats

#### Scenario: Valid JWT is accepted

- **WHEN** an admin route is requested with a token that validates against the configured Access JWKS with the expected audience and issuer and is unexpired
- **THEN** the Worker treats the request as an authenticated maintainer and proceeds

### Requirement: Aggregate Stats API

The telemetry backend SHALL expose a read-only stats API under `/api/admin/*` that returns aggregate anonymous usage metrics: overview totals, a daily active-users series, a per-command breakdown, and a per-version breakdown. Event counts SHALL use the sampling-accurate sum of the sample interval; distinct-user counts SHALL be returned and labelled approximate. The API SHALL accept a requested time range that MAY extend beyond the Analytics Engine retention window (including all history), serving such ranges from the durable rollup store; it SHALL annotate each response with the data source (hot Analytics Engine vs. cold rollup store) that produced it. The API SHALL accept a hide-test-traffic option that, when enabled, excludes smoke-test events (version `0.0.0`) from the returned aggregates.

#### Scenario: Overview returns 24h and 7d totals

- **WHEN** an authenticated maintainer requests the overview endpoint
- **THEN** the response includes total events and distinct users for the last 24 hours and the last 7 days, with event totals computed sampling-accurately and distinct-user counts marked approximate

#### Scenario: Daily active users series

- **WHEN** an authenticated maintainer requests the daily-active-users endpoint for a bounded number of days
- **THEN** the response includes a per-day series of event and distinct-user counts over that window

#### Scenario: Command and version breakdowns

- **WHEN** an authenticated maintainer requests the command or version breakdown endpoint
- **THEN** the response includes usage grouped by command (or by version), ordered by event count

#### Scenario: Stats API is read-only

- **WHEN** any admin API endpoint is invoked
- **THEN** it performs only reads of aggregate anonymous data and never mutates stored data

#### Scenario: All-history range served from the cold layer with source annotation

- **WHEN** an authenticated maintainer requests a stats endpoint for all history (or a window past the Analytics Engine retention)
- **THEN** the response is computed from the durable rollup store and is annotated with a cold data source

#### Scenario: Recent range served from the hot layer with source annotation

- **WHEN** an authenticated maintainer requests a stats endpoint for a window within the Analytics Engine retention
- **THEN** the response is computed from Analytics Engine and is annotated with a hot data source

#### Scenario: Hide-test-traffic excludes smoke-test events

- **WHEN** a stats endpoint is requested with the hide-test-traffic option enabled
- **THEN** events whose version is `0.0.0` are excluded from the returned aggregates, on both the hot and cold layers

### Requirement: Graceful Degradation When Read Token Absent

The telemetry backend SHALL respond with a clean, explanatory error rather than crashing when the Cloudflare SQL API read token is not configured, so that the Worker is safe to deploy before the token exists.

#### Scenario: Missing read token yields a clean error

- **WHEN** a stats endpoint is requested (by an authenticated maintainer) while the SQL API read token is not configured
- **THEN** the Worker responds `503` with an explanatory message and does not crash or expose an internal error

#### Scenario: Upstream SQL API failure is surfaced cleanly

- **WHEN** the Cloudflare SQL API returns an error to a stats request
- **THEN** the Worker responds with a non-2xx status and an explanatory message rather than an unhandled failure

### Requirement: Custom Domain Delivery

The telemetry backend SHALL be reachable at the custom domain `telemetry.rasen.io` once its Cloudflare zone is active, while keeping the existing `workers.dev` endpoint enabled for the public ingest path. Attaching the custom domain SHALL be an independent, retryable step that does not block deploying or operating the Worker.

#### Scenario: Custom domain attached when zone is active

- **WHEN** the `rasen.io` zone is active on Cloudflare and the Worker is deployed with the custom-domain route
- **THEN** the Worker answers requests on `telemetry.rasen.io` and continues to answer on its `workers.dev` endpoint

#### Scenario: Inactive zone does not block delivery

- **WHEN** the `rasen.io` zone is not yet active
- **THEN** the Worker still deploys and operates on `workers.dev`, and the custom-domain attach is recorded as a pending retryable step

### Requirement: Dashboard Filtering and Time Range

The admin panel SHALL let a maintainer choose a time range covering at least
7 days, 30 days, 90 days, and all history through a segmented control of
mutually-exclusive buttons, with the active range visually highlighted; filter
the displayed aggregates by command, version, and os dimensions through rows of
clickable pills populated from the current breakdown data, where an "All"
default pill is selected until the maintainer clicks a value, and clicking the
selected value again returns to "All"; and toggle whether smoke-test traffic is
included through a switch control that defaults to hide test traffic. A selected
dimension value SHALL persist across a data refresh, including when that value is
absent from the refreshed breakdown. A pill label longer than 40 characters SHALL
be truncated for display while its full value remains available on hover. The
control affordances SHALL be operable by keyboard and expose their selected state
to assistive technology. The panel SHALL remain a single self-contained document
requiring no build step and no external assets, and SHALL indicate the data source
(recent live data vs. historical aggregates) backing the current view.

#### Scenario: Time range selection changes the window

- **WHEN** a maintainer activates a different time-range button (for example all history)
- **THEN** the panel marks that button as the active range and reloads its aggregates for that window, reflecting the new numbers

#### Scenario: Dimension filter narrows the view

- **WHEN** a maintainer clicks a command, version, or os pill
- **THEN** the pill becomes the selected value and the panel shows aggregates restricted to that dimension value

#### Scenario: Deselecting a dimension returns to All

- **WHEN** a maintainer clicks the currently selected command, version, or os pill again
- **THEN** the selection returns to the "All" default and the panel shows aggregates unrestricted on that dimension

#### Scenario: Selected value persists across refresh even when absent

- **WHEN** a dimension value is selected and the data is refreshed such that the value is no longer present in the returned breakdown
- **THEN** the panel keeps that value selected and continues to offer it as a pill

#### Scenario: Long pill label is truncated with full value on hover

- **WHEN** a dimension value longer than 40 characters is shown as a pill
- **THEN** the pill displays a truncated label and reveals the full value on hover

#### Scenario: Hide-test-traffic defaults on

- **WHEN** the panel first loads
- **THEN** the toggle switch is on and smoke-test traffic (version `0.0.0`) is excluded by default, and the maintainer can switch it off to include that traffic

#### Scenario: Controls are keyboard and assistive-technology accessible

- **WHEN** a maintainer navigates the time-range and dimension controls by keyboard
- **THEN** each control is focusable, activatable from the keyboard, and reports its selected (pressed) state to assistive technology

#### Scenario: Empty data does not break the layout

- **WHEN** a selected window or filter returns no data
- **THEN** the panel shows its no-data state without horizontal overflow or broken layout at any viewport width

#### Scenario: Panel still ships as a single no-build file

- **WHEN** the panel is deployed
- **THEN** it is delivered as one self-contained document with no bundler, compile step, or external asset introduced to the Worker

