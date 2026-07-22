# management-http-api Delta Specification

> Stacked delta: the REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-workflows-page` (W4) change's delta to this spec — W4 (and transitively W6) must archive before this change.

## REMOVED Requirements

### Requirement: Loopback and bearer security with an enumerated CLI-backed mutation set

**Reason**: Its mutating-endpoint enumeration is closed at four endpoints, and the pipeline-library capability adds `POST /api/v1/pipelines` under the same rule. Replaced by "Loopback and bearer security across the CLI-backed mutation surface", which carries the grown enumeration.
**Migration**: All security posture (loopback, bearer token, 405 handling, fresh reads, trailing-slash tolerance) and the never-writes-workspace-files rule carry over verbatim; only the enumeration of admitted mutating endpoints grows by one.

## ADDED Requirements

### Requirement: Loopback and bearer security across the CLI-backed mutation surface

The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, `GET /api/v1/runs`, and `POST /api/v1/changes`, bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup. The server SHALL never write workspace files itself: every endpoint that mutates a workspace, creates planning state, or modifies a user-wide library — `POST /api/v1/changes` (change submission), `POST /api/v1/sessions` (session launch), `POST /api/v1/spaces` (space creation), `POST /api/v1/workflows` (workflow library mutation), and `POST /api/v1/pipelines` (pipeline library mutation) — SHALL mutate exclusively by spawning the existing CLI as a subprocess under its capability's admission whitelist. Any other method on a management path SHALL be rejected with 405 `method_not_allowed` without modifying any file. Every read response SHALL be computed from a fresh filesystem read at request time. Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; deeper suffixes are not management paths and fall through to the rest of the server's routing.

#### Scenario: Authorized status request

- **WHEN** a client sends `GET /api/v1/status` with the session bearer token
- **THEN** the server responds 200 with JSON containing the CLI version, the server process id, and the launch project reference (or null outside a project)

#### Scenario: Missing or invalid token

- **WHEN** a client sends any `/api/v1/*` request without a valid bearer token
- **THEN** the server responds 401 with the error envelope `{ error: { code: "unauthorized" } }`

#### Scenario: Unadmitted write methods rejected

- **WHEN** a client sends PUT or DELETE to any management endpoint, or POST to `/api/v1/status` or `/api/v1/runs`
- **THEN** the server responds 405 with error code `method_not_allowed` and does not modify any file

#### Scenario: Every mutating endpoint routes through a CLI subprocess

- **WHEN** any admitted mutating request (`POST /api/v1/changes`, `POST /api/v1/sessions`, `POST /api/v1/spaces`, `POST /api/v1/workflows`, `POST /api/v1/pipelines`) is fulfilled
- **THEN** the mutation is performed by a spawned CLI subprocess and the server process itself writes no workspace or library file

#### Scenario: Fresh read on every request

- **WHEN** a change's on-disk state is modified between two identical requests
- **THEN** the second response reflects the new on-disk state without any server restart

#### Scenario: Trailing slash tolerated on management paths

- **WHEN** a client sends `GET /api/v1/status/` (one trailing slash) with the session bearer token
- **THEN** the response is identical to `GET /api/v1/status`, not a 404 from another route group
