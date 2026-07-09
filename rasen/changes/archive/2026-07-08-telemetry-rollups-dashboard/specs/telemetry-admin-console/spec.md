## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Dashboard Filtering and Time Range

The admin panel SHALL let a maintainer choose a time range covering at least
7 days, 30 days, 90 days, and all history; filter the displayed aggregates by
command, version, and os dimensions; and toggle whether smoke-test traffic is
included, with the toggle defaulting to hide test traffic. The panel SHALL remain
a single self-contained document requiring no build step, and SHALL indicate the
data source (recent live data vs. historical aggregates) backing the current view.

#### Scenario: Time range selection changes the window

- **WHEN** a maintainer selects a different time range (for example all history)
- **THEN** the panel reloads its aggregates for that window and reflects the new numbers

#### Scenario: Dimension filter narrows the view

- **WHEN** a maintainer applies a command, version, or os filter
- **THEN** the panel shows aggregates restricted to the selected dimension value

#### Scenario: Hide-test-traffic defaults on

- **WHEN** the panel first loads
- **THEN** smoke-test traffic (version `0.0.0`) is excluded by default, and the maintainer can toggle it back on to include it

#### Scenario: Panel still ships as a single no-build file

- **WHEN** the panel is deployed
- **THEN** it is delivered as one self-contained document with no bundler or compile step introduced to the Worker
