## MODIFIED Requirements

### Requirement: Loopback and bearer security with a single CLI-backed write endpoint
The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, `GET /api/v1/runs`, `POST /api/v1/changes`, and the sessions route group (`POST /api/v1/sessions`, `GET /api/v1/sessions`, `GET /api/v1/sessions/:id`, `DELETE /api/v1/sessions/:id`), bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup. Exactly two kinds of mutation SHALL exist, and both mutate exclusively by spawning subprocesses: `POST /api/v1/changes` spawns the CLI per the change-submission capability, and the sessions endpoints launch and terminate supervised agent sessions per the session-supervision capability — the server itself never writes workspace files. Any other method on a management path SHALL be rejected with 405 `method_not_allowed` without modifying any file; DELETE SHALL be admitted only on `/api/v1/sessions/:id`. Every read response SHALL be computed from a fresh filesystem read at request time, except session listings, whose process facts come from the live in-memory registry (their joined run-state is still read fresh from disk). Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; `/api/v1/sessions/:id` SHALL match exactly one additional path segment, and deeper suffixes are not management paths and fall through to the rest of the server's routing. All sessions endpoints SHALL follow the same authentication and CSRF posture as the change-submission write path: bearer token only, never cookies, and no CORS headers on any response.

#### Scenario: Authorized status request
- **WHEN** a client sends `GET /api/v1/status` with the session bearer token
- **THEN** the server responds 200 with JSON containing the CLI version, the server process id, and the launch project reference (or null outside a project)

#### Scenario: Missing or invalid token
- **WHEN** a client sends any `/api/v1/*` request without a valid bearer token
- **THEN** the server responds 401 with the error envelope `{ error: { code: "unauthorized" } }`

#### Scenario: Unadmitted write methods rejected
- **WHEN** a client sends PUT to any management endpoint, DELETE to a non-sessions management endpoint, or POST to `/api/v1/status` or `/api/v1/runs`
- **THEN** the server responds 405 with error code `method_not_allowed` and does not modify any file

#### Scenario: Admitted write endpoint routes to the submission bridge
- **WHEN** a client sends an authorized `POST /api/v1/changes`
- **THEN** the request is handled by the CLI-backed submission bridge rather than rejected with 405

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
