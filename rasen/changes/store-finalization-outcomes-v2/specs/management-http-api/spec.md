## MODIFIED Requirements

### Requirement: Loopback and bearer security across the CLI-backed mutation surface

The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, `GET /api/v1/runs`, `POST /api/v1/changes`, the sessions route group (`POST /api/v1/sessions`, `GET /api/v1/sessions`, `GET /api/v1/sessions/:id`, `DELETE /api/v1/sessions/:id`), and the Store change-finalization path (`POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize`), bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup. The server SHALL never write workspace files itself: every endpoint that mutates a workspace, creates planning state, or modifies a user-wide library — `POST /api/v1/changes` (change submission), `POST /api/v1/sessions` (session launch), `POST /api/v1/spaces` (space creation), `POST /api/v1/workflows` (workflow library mutation), `POST /api/v1/pipelines` (pipeline library mutation), and the Store change-finalization path (change finalization) — SHALL mutate exclusively by spawning the existing CLI as a subprocess under its capability's admission whitelist. Any other method on a management path SHALL be rejected with 405 `method_not_allowed` without modifying any file; DELETE SHALL be admitted only on `/api/v1/sessions/:id`. Every read response SHALL be computed from a fresh filesystem read at request time, except session listings, whose process facts come from the live in-memory registry (their joined run-state is still read fresh from disk). Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; `/api/v1/sessions/:id` SHALL match exactly one additional path segment, and deeper suffixes are not management paths and fall through to the rest of the server's routing.

#### Scenario: Authorized status request

- **WHEN** a client sends `GET /api/v1/status` with the session bearer token
- **THEN** the server responds 200 with JSON containing the CLI version, the server process id, and the launch project reference (or null outside a project)

#### Scenario: Missing or invalid token

- **WHEN** a client sends any `/api/v1/*` request without a valid bearer token
- **THEN** the server responds 401 with the error envelope `{ error: { code: "unauthorized" } }`

#### Scenario: Unadmitted write methods rejected
- **WHEN** a client sends PUT to any management endpoint, DELETE to a non-sessions management endpoint, or POST to `/api/v1/status` or `/api/v1/runs`
- **THEN** the server responds 405 with error code `method_not_allowed` and does not modify any file

#### Scenario: Every mutating endpoint routes through a CLI subprocess

- **WHEN** any admitted mutating request (`POST /api/v1/changes`, `POST /api/v1/sessions`, `POST /api/v1/spaces`, `POST /api/v1/workflows`, `POST /api/v1/pipelines`, or the Store change-finalization path) is fulfilled
- **THEN** the mutation is performed by a spawned CLI subprocess and the server process itself writes no workspace or library file

#### Scenario: Sessions endpoints share the write security posture
- **WHEN** a client sends an unauthenticated request to any sessions endpoint, or inspects any sessions response for CORS headers
- **THEN** the unauthenticated request is rejected 401 spawning and signalling nothing, and no sessions response carries an `Access-Control-Allow-Origin` header

#### Scenario: Fresh read on every request
- **WHEN** a change's on-disk state is modified between two identical requests
- **THEN** the second response reflects the new on-disk state without any server restart

#### Scenario: Trailing slash tolerated on management paths
- **WHEN** a client sends `GET /api/v1/status/` (one trailing slash) with the session bearer token
- **THEN** the response is identical to `GET /api/v1/status`, not a 404 from another route group

#### Scenario: Session id paths route to the sessions group only one segment deep
- **WHEN** a client addresses `/api/v1/sessions/<id>` versus `/api/v1/sessions/<id>/extra`
- **THEN** the single-segment form is handled by the sessions route group and the deeper form falls through to the rest of the server's routing

## ADDED Requirements

### Requirement: The change-finalization endpoint requires a complete scope and one explicit outcome

`POST /api/v1/stores/:storeUid/projects/:projectId/lines/:targetLineId/changes/:instance/finalize` SHALL finalize exactly one Change and SHALL require its complete scope — Store, project, stable target line, and Change instance — in the path, plus the outcome and the reason or successor that outcome requires in the body. The server SHALL NOT complete a missing or ambiguous scope field from a query filter, a session, a launch project, or a previously viewed selection, and SHALL reject the request instead. It SHALL mutate only by spawning the CLI, SHALL produce the same finalization plan the command-line and workflow surfaces produce for the same inputs, and SHALL return the recorded outcome, the published entry path, and whether spec synchronization was applied. A request whose path scope disagrees with the Change's committed identity SHALL be rejected with the finalization diagnostic rather than reinterpreted, and a failed finalization SHALL surface the CLI's diagnostic code unchanged.

#### Scenario: An incomplete scope is rejected, not inferred

- **WHEN** a finalization request omits the target line or the Change instance, or names one that disagrees with the Change's committed identity
- **THEN** the server responds with an error naming the disagreement
- **AND** no CLI subprocess that would mutate is spawned and no file is modified

#### Scenario: A finalization is fulfilled by the CLI and reported

- **WHEN** an authorized finalization request supplies a complete scope and a valid outcome
- **THEN** the mutation is performed by a spawned CLI subprocess
- **AND** the response reports the recorded outcome, the published entry path, and whether spec synchronization was applied

#### Scenario: A refused finalization surfaces its diagnostic unchanged

- **WHEN** the CLI refuses the finalization because the outcome is invalid, the landed commit is unreachable, or the successor cannot be verified
- **THEN** the response carries that diagnostic code and message unchanged
- **AND** no partial archive entry, spec write, or record file exists afterward
