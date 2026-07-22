# management-http-api Delta Specification

> Stacked delta: the REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-spaces-page` change's delta to this spec. That change must archive before this one (portfolio ship order guarantees it).

## REMOVED Requirements

### Requirement: Loopback and bearer security with CLI-backed mutation

**Reason**: Its mutating-endpoint enumeration (`POST /api/v1/changes`, `POST /api/v1/sessions`, `POST /api/v1/spaces`) is closed, and the workflow-library capability adds `POST /api/v1/workflows` under the same rule. Replaced by "Loopback and bearer security with an enumerated CLI-backed mutation set", which carries the grown enumeration.
**Migration**: All security posture (loopback, bearer token, 405 handling, fresh reads, trailing-slash tolerance) and the never-writes-workspace-files rule carry over verbatim; only the enumeration of admitted mutating endpoints grows by one.

## ADDED Requirements

### Requirement: Loopback and bearer security with an enumerated CLI-backed mutation set

The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, `GET /api/v1/runs`, and `POST /api/v1/changes`, bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup. The server SHALL never write workspace files itself: every endpoint that mutates a workspace, creates planning state, or modifies the user-wide library — `POST /api/v1/changes` (change submission), `POST /api/v1/sessions` (session launch), `POST /api/v1/spaces` (space creation), and `POST /api/v1/workflows` (workflow library mutation) — SHALL mutate exclusively by spawning the existing CLI as a subprocess under its capability's admission whitelist. Any other method on a management path SHALL be rejected with 405 `method_not_allowed` without modifying any file. Every read response SHALL be computed from a fresh filesystem read at request time. Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; deeper suffixes are not management paths and fall through to the rest of the server's routing.

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

- **WHEN** any admitted mutating request (`POST /api/v1/changes`, `POST /api/v1/sessions`, `POST /api/v1/spaces`, `POST /api/v1/workflows`) is fulfilled
- **THEN** the mutation is performed by a spawned CLI subprocess and the server process itself writes no workspace or library file

#### Scenario: Fresh read on every request

- **WHEN** a change's on-disk state is modified between two identical requests
- **THEN** the second response reflects the new on-disk state without any server restart

#### Scenario: Trailing slash tolerated on management paths

- **WHEN** a client sends `GET /api/v1/status/` (one trailing slash) with the session bearer token
- **THEN** the response is identical to `GET /api/v1/status`, not a 404 from another route group

### Requirement: The workflow paths serve listing, detail, validation, and mutation under the management security posture

`GET /api/v1/workflows`, `GET /api/v1/workflows/<id>` (exactly one segment deep), and `GET /api/v1/workflow-validation` SHALL be served by the management server with the same loopback bind, bearer-token requirement, trailing-slash tolerance, and fresh-read posture as the other management paths; their content contracts are defined by the workflow-http-api capability. `POST /api/v1/workflows` SHALL be admitted and served by the workflow-http-api capability's CLI-backed bridge. PUT and DELETE on the workflow paths SHALL be rejected with 405, as SHALL POST to `/api/v1/workflow-validation`.

#### Scenario: Workflow paths require the session token

- **WHEN** a client sends any `/api/v1/workflows` or `/api/v1/workflow-validation` request without a valid bearer token
- **THEN** the response is 401 with the `unauthorized` error envelope

#### Scenario: Admitted POST routes to the workflow bridge

- **WHEN** a client sends an authorized `POST /api/v1/workflows`
- **THEN** the request is handled by the CLI-backed workflow mutation bridge rather than rejected with 405

#### Scenario: Unadmitted methods on workflow paths rejected

- **WHEN** a client sends PUT or DELETE to `/api/v1/workflows`, or POST to `/api/v1/workflow-validation`
- **THEN** the response is 405 `method_not_allowed` and no file is modified

#### Scenario: Deeper workflow suffixes are not management paths

- **WHEN** a client requests `/api/v1/workflows/<id>/extra`
- **THEN** the request falls through to the rest of the server's routing rather than being answered as a workflow path
