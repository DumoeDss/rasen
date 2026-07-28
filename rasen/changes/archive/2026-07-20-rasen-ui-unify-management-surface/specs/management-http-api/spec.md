## MODIFIED Requirements

### Requirement: Read-only management API with loopback and bearer security
The management API SHALL serve `GET /api/v1/status`, `GET /api/v1/changes`, and `GET /api/v1/runs` bound to 127.0.0.1 only, requiring a per-session bearer token minted at server startup, and SHALL expose no endpoint that mutates project state. Every response SHALL be computed from a fresh filesystem read at request time. Each management path SHALL also answer when addressed with a single trailing slash (e.g. `/api/v1/status/`), identically to its canonical form; deeper suffixes are not management paths and fall through to the rest of the server's routing.

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

#### Scenario: Trailing slash tolerated on management paths
- **WHEN** a client sends `GET /api/v1/status/` (one trailing slash) with the session bearer token
- **THEN** the response is identical to `GET /api/v1/status`, not a 404 from another route group
