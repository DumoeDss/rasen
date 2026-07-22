# management-http-api Delta Specification

## REMOVED Requirements

### Requirement: Loopback and bearer security with a single CLI-backed write endpoint

**Reason**: The "`POST /api/v1/changes` SHALL be the only mutating endpoint" clause is stale — `POST /api/v1/sessions` already mutates, and this change adds `POST /api/v1/spaces`. Replaced by "Loopback and bearer security with CLI-backed mutation", which states the general rule instead of a named exception.
**Migration**: All security posture (loopback, bearer token, 405 handling, fresh reads, trailing-slash tolerance) carries over verbatim; only the single-endpoint claim is generalized.

### Requirement: The spaces listing is a management endpoint under the same security posture

**Reason**: Its "Non-GET rejected" scenario mandates 405 for POST on `/api/v1/spaces`, which the space-creation capability now admits. Replaced by "The spaces path serves listing and creation under the management security posture".
**Migration**: GET behavior and its content contract (planning-space-addressing) are unchanged; only POST admission changes.

## ADDED Requirements

### Requirement: Loopback and bearer security with CLI-backed mutation

The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, `GET /api/v1/runs`, and `POST /api/v1/changes`, bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup. The server SHALL never write workspace files itself: every endpoint that mutates a workspace or creates planning state — `POST /api/v1/changes` (change submission), `POST /api/v1/sessions` (session launch), and `POST /api/v1/spaces` (space creation) — SHALL mutate exclusively by spawning the existing CLI as a subprocess under its capability's admission whitelist. Any other method on a management path SHALL be rejected with 405 `method_not_allowed` without modifying any file. Every read response SHALL be computed from a fresh filesystem read at request time. Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; deeper suffixes are not management paths and fall through to the rest of the server's routing.

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

- **WHEN** any admitted mutating request (`POST /api/v1/changes`, `POST /api/v1/sessions`, `POST /api/v1/spaces`) is fulfilled
- **THEN** the mutation is performed by a spawned CLI subprocess and the server process itself writes no workspace file

#### Scenario: Fresh read on every request

- **WHEN** a change's on-disk state is modified between two identical requests
- **THEN** the second response reflects the new on-disk state without any server restart

#### Scenario: Trailing slash tolerated on management paths

- **WHEN** a client sends `GET /api/v1/status/` (one trailing slash) with the session bearer token
- **THEN** the response is identical to `GET /api/v1/status`, not a 404 from another route group

### Requirement: The spaces path serves listing and creation under the management security posture

`GET /api/v1/spaces` SHALL be served by the management server with the same loopback bind, bearer-token requirement, trailing-slash tolerance, and fresh-read posture as the other management paths; its listing content contract is defined by the planning-space-addressing capability and is unchanged by creation support. `POST /api/v1/spaces` SHALL be admitted and served by the space-creation capability's CLI-backed bridge. PUT and DELETE on the path SHALL be rejected with 405. `GET /api/v1/local-paths` SHALL likewise be a GET-only management path under the same security posture, with its content contract defined by the local-path-browsing capability.

#### Scenario: Spaces requires the session token

- **WHEN** a client sends `GET /api/v1/spaces` or `POST /api/v1/spaces` without a valid bearer token
- **THEN** the response is 401 with the `unauthorized` error envelope

#### Scenario: Admitted POST routes to the creation bridge

- **WHEN** a client sends an authorized `POST /api/v1/spaces`
- **THEN** the request is handled by the CLI-backed space-creation bridge rather than rejected with 405

#### Scenario: Unadmitted methods still rejected

- **WHEN** a client sends PUT or DELETE to `/api/v1/spaces`, or POST to `/api/v1/local-paths`
- **THEN** the response is 405 `method_not_allowed` and no file is modified

#### Scenario: Listing behavior unchanged by creation support

- **WHEN** a client sends `GET /api/v1/spaces` after creation support ships
- **THEN** the response content matches the planning-space-addressing contract exactly as before, and answering it mutates nothing
