# management-http-api Specification (delta)

## REMOVED Requirements

### Requirement: Read-only management API with loopback and bearer security
**Reason**: Slice 2 introduces the platform's first write path; the API is no longer read-only, so the requirement's name and its "no mutating endpoint" / blanket "write methods rejected" clauses are replaced rather than edited in place (renames require REMOVED+ADDED).
**Migration**: Replaced by "Loopback and bearer security with a single CLI-backed write endpoint" below, which preserves every security property (loopback bind, per-session bearer token, fresh reads, trailing-slash tolerance, 405 for unadmitted methods) while admitting exactly `POST /api/v1/changes`, whose behavior is specified by the `change-submission` capability.

## ADDED Requirements

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
