# management-http-api Specification

## Purpose
Provide a read-only, loopback-bound, bearer-secured HTTP API exposing project status, active changes, and run state for the management UI, always computed fresh from disk.

## Requirements
### Requirement: Loopback and bearer security with a single CLI-backed write endpoint
The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, `GET /api/v1/runs`, and `POST /api/v1/changes`, bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup. `POST /api/v1/changes` SHALL be the only mutating endpoint, and it SHALL mutate exclusively by spawning the existing CLI as a subprocess (per the change-submission capability) — the server itself never writes workspace files. Any other method on a management path SHALL be rejected with 405 `method_not_allowed` without modifying any file. Every read response SHALL be computed from a fresh filesystem read at request time. Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; deeper suffixes are not management paths and fall through to the rest of the server's routing.

#### Scenario: Authorized status request
- **WHEN** a client sends `GET /api/v1/status` with the session bearer token
- **THEN** the server responds 200 with JSON containing the CLI version, the server process id, and the launch project reference (or null outside a project)

#### Scenario: Missing or invalid token
- **WHEN** a client sends any `/api/v1/*` request without a valid bearer token
- **THEN** the server responds 401 with the error envelope `{ error: { code: "unauthorized" } }`

#### Scenario: Unadmitted write methods rejected
- **WHEN** a client sends PUT or DELETE to any management endpoint, or POST to `/api/v1/status` or `/api/v1/runs`
- **THEN** the server responds 405 with error code `method_not_allowed` and does not modify any file

#### Scenario: Admitted write endpoint routes to the submission bridge
- **WHEN** a client sends an authorized `POST /api/v1/changes`
- **THEN** the request is handled by the CLI-backed submission bridge rather than rejected with 405

#### Scenario: Fresh read on every request
- **WHEN** a change's on-disk state is modified between two identical requests
- **THEN** the second response reflects the new on-disk state without any server restart

#### Scenario: Trailing slash tolerated on management paths
- **WHEN** a client sends `GET /api/v1/status/` (one trailing slash) with the session bearer token
- **THEN** the response is identical to `GET /api/v1/status`, not a 404 from another route group

### Requirement: Daemon identity headers on every management-server response
Every response from the management server SHALL carry the headers `x-rasen-daemon: <version>` and `x-rasen-pid: <pid>`, including error responses, static asset responses, and responses delegated to the config API route group, so a consumer can classify what is listening on a port by probing any path.

#### Scenario: Identity headers on a management endpoint
- **WHEN** a client requests `GET /api/v1/status`
- **THEN** the response includes `x-rasen-daemon` set to the CLI version and `x-rasen-pid` set to the server's process id

#### Scenario: Identity headers on delegated and unauthorized responses
- **WHEN** a client requests a config-API path or sends an unauthenticated request to the management server
- **THEN** the response still carries both `x-rasen-daemon` and `x-rasen-pid` headers

### Requirement: Changes listing matches the workflow's active-change definition
`GET /api/v1/changes` SHALL list the project's active changes with, per change: name, schema name, per-artifact status (done / ready / blocked), whether all apply-required artifacts are complete, and task progress (total and completed counts). Change enumeration SHALL use `getActiveChangeIds` — the same source of truth as `rasen status`, `validate`, `archive`, and the instruction loader — which requires a `proposal.md` in the change directory. Per-change status SHALL be derived from the same core status logic those commands use, so the listing agrees with `rasen status` for the same project state.

This definition is intentionally narrower than `rasen list`, whose bare directory scan also reports change directories that hold only planning documents and that no workflow command can act on. The endpoint SHALL NOT be widened to reproduce that scan; converging `rasen list` onto `getActiveChangeIds` is a recorded follow-up outside this change.

#### Scenario: Active changes listed with status
- **WHEN** a project has active changes with differing artifact and task completion
- **THEN** the response lists each active change with its schema name, artifact statuses, apply-readiness, and task counts matching what `rasen status` reports

#### Scenario: Archived changes excluded
- **WHEN** a project has archived changes alongside active ones
- **THEN** only active changes appear in the listing

#### Scenario: Directory without a proposal excluded
- **WHEN** a directory under `rasen/changes/` contains planning documents but no `proposal.md`
- **THEN** it is absent from the listing, matching `rasen status` rather than `rasen list`

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
