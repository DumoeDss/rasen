## MODIFIED Requirements

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
