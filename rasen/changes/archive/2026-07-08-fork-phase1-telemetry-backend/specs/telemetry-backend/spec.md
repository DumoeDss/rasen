## ADDED Requirements

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

The telemetry backend SHALL reject malformed requests with a 4xx status and SHALL only accept the documented HTTP method, so that garbage input is not persisted.

#### Scenario: Missing required field is rejected

- **WHEN** a request omits `command`, `version`, or `distinctId`
- **THEN** the endpoint responds with a 4xx status and records nothing

#### Scenario: Non-POST method is rejected

- **WHEN** a request uses a method other than `POST` (for example `GET`)
- **THEN** the endpoint responds with a non-2xx status and records nothing

#### Scenario: Unexpected fields are not persisted

- **WHEN** a request includes fields beyond the documented contract (for example a file path or arguments)
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
