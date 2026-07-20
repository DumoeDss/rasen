# management-http-api

## ADDED Requirements

### Requirement: Read-only management API with loopback and bearer security
The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, and `GET /api/v1/runs` bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup, and SHALL expose no endpoint that mutates project state. Every response SHALL be computed from a fresh filesystem read at request time.

#### Scenario: Authorized status request
- **WHEN** a client sends `GET /api/v1/status` with the session bearer token
- **THEN** the server responds 200 with JSON containing the CLI version, the server process id, and the launch project reference (or null outside a project)

#### Scenario: Missing or invalid token
- **WHEN** a client sends any `/api/v1/*` request without a valid bearer token
- **THEN** the server responds 401 with the error envelope `{ error: { code: "unauthorized" } }`

#### Scenario: Write methods rejected
- **WHEN** a client sends a non-GET method (POST, PUT, DELETE) to a management endpoint
- **THEN** the server responds 405 with error code `method_not_allowed` and does not modify any file

#### Scenario: Fresh read on every request
- **WHEN** a change's on-disk state is modified between two identical requests
- **THEN** the second response reflects the new on-disk state without any server restart

### Requirement: Daemon identity headers on every management-server response
Every response from the management server SHALL carry the headers `x-rasen-daemon: <version>` and `x-rasen-pid: <pid>`, including error responses, static asset responses, and responses delegated to the config API route group, so a consumer can classify what is listening on a port by probing any path.

#### Scenario: Identity headers on a management endpoint
- **WHEN** a client requests `GET /api/v1/status`
- **THEN** the response includes `x-rasen-daemon` set to the CLI version and `x-rasen-pid` set to the server's process id

#### Scenario: Identity headers on delegated and unauthorized responses
- **WHEN** a client requests a config-API path or sends an unauthenticated request to the management server
- **THEN** the response still carries both `x-rasen-daemon` and `x-rasen-pid` headers

### Requirement: Changes listing matches CLI-visible change state
`GET /api/v1/changes` SHALL list the project's active changes with, per change: name, schema name, per-artifact status (done / ready / blocked), whether all apply-required artifacts are complete, and task progress (total and completed counts). The data SHALL be derived from the same core change-enumeration and status logic the CLI uses, so the listing agrees with `rasen change list` and `rasen status` for the same project state.

#### Scenario: Active changes listed with status
- **WHEN** a project has active changes with differing artifact and task completion
- **THEN** the response lists each active change with its schema name, artifact statuses, apply-readiness, and task counts matching what the CLI reports

#### Scenario: Archived changes excluded
- **WHEN** a project has archived changes alongside active ones
- **THEN** only active changes appear in the listing

#### Scenario: No project resolvable
- **WHEN** the server was launched outside any Rasen project and no project selector is provided
- **THEN** the endpoint responds with an error envelope indicating no project is available, not an empty success

### Requirement: Run-state reporting reads live run files without side effects
`GET /api/v1/runs` SHALL report, per active change, the pipeline run state read from `auto-run.json`, `goal-run.json`, and `portfolio-run.json` at their resolved locations (machine-home work directory first, change directory as legacy fallback). Resolution SHALL be non-mutating: a request never creates directories, registry entries, or project identity. Each run file SHALL be reported as parsed content when valid, as invalid-with-reason when present but unparseable, or as absent — and a failure while reading one change SHALL degrade to an error entry for that change rather than failing the whole response.

#### Scenario: Active run reported
- **WHEN** a change has a valid `auto-run.json` in its work directory
- **THEN** the response includes that change with its pipeline name and per-stage statuses

#### Scenario: Invalid run file surfaced
- **WHEN** a change's `auto-run.json` exists but fails parsing or schema validation
- **THEN** the response marks that change's run state as invalid and includes a human-readable reason, and the overall request still succeeds

#### Scenario: No run state
- **WHEN** a change has no run-state files in either resolved location
- **THEN** the response reports that change's runs as absent

#### Scenario: Read-only resolution for unregistered projects
- **WHEN** runs are requested for a project that has no machine-home registration
- **THEN** the server answers using only legacy change-directory locations and creates no registry entry, identity, or directory as a side effect
