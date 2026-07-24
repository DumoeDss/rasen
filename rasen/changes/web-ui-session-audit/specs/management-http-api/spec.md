## ADDED Requirements

### Requirement: Audit paths use the management server security posture

The management server SHALL expose `GET /api/v1/audits/sessions`, `GET /api/v1/audits`, `GET /api/v1/audits/<report-id>`, `POST /api/v1/audits`, and `POST /api/v1/audits/import` on the loopback interface under the same per-launch bearer-token requirement and standard error envelope as the other management paths. Collection/import paths and a report-id path SHALL match only their exact documented depth, tolerate one trailing slash, and reject unsupported methods with `405 method_not_allowed`.

#### Scenario: Audit API requires the launch token
- **WHEN** a client requests any audit endpoint without the valid bearer token
- **THEN** the server returns 401 and performs no discovery, read, import, or analysis

#### Scenario: Exact report path is admitted
- **WHEN** an authenticated client requests `/api/v1/audits/<encoded-report-id>`
- **THEN** the server decodes exactly one path segment and returns that valid saved report or a standard 404 error

#### Scenario: Deeper audit suffix is not admitted
- **WHEN** a client requests `/api/v1/audits/<report-id>/extra`
- **THEN** the request is not treated as a saved-report lookup

#### Scenario: Unsupported method is rejected
- **WHEN** an authenticated client sends PUT or DELETE to an audit path
- **THEN** the server returns `405 method_not_allowed` without changing analytics files

### Requirement: Recent-session discovery is bounded to established local stores

`GET /api/v1/audits/sessions` SHALL return a server-capped, newest-first list of auditable root sessions from the established Claude, Codex, and Zed local stores. Each record SHALL carry an exact runtime and session id plus available display metadata, but SHALL NOT expose a browser-round-trippable source path. Failure to read one runtime store SHALL be represented as a per-runtime unavailability diagnostic while other runtime results remain successful.

#### Scenario: Multiple runtimes are combined
- **WHEN** established local stores contain recent Claude, Codex, and Zed root sessions
- **THEN** one response returns their records globally ordered by recency and capped at the server limit

#### Scenario: Missing store is fail-soft
- **WHEN** one runtime's default store does not exist
- **THEN** the response names that runtime as unavailable and still returns discoverable sessions from other runtimes

#### Scenario: Client limit cannot create an unbounded scan response
- **WHEN** a client requests a limit above the server maximum or supplies an invalid limit
- **THEN** the server applies its maximum or returns a bounded input error and never emits an unbounded result

### Requirement: Native audit execution re-resolves exact session identities

`POST /api/v1/audits` SHALL accept only a supported runtime plus exact session id, re-resolve that identity inside the runtime's established local store, invoke the existing audit engine, and write the normal report under the resolved Rasen analytics directory. It SHALL return the saved descriptor and report on success. The endpoint SHALL NOT accept a transcript/database path in this request.

#### Scenario: Discovered session is audited
- **WHEN** an authenticated client submits the runtime and exact id of a discoverable native session
- **THEN** the server analyzes it with the existing runtime-specific audit behavior, writes the standard report, and returns the report detail

#### Scenario: Session disappeared after listing
- **WHEN** the submitted exact session no longer resolves in the established store
- **THEN** the server returns a standard actionable not-found error and does not guess another session

#### Scenario: Path field is rejected
- **WHEN** a client attempts to submit a filesystem path instead of a runtime/session identity
- **THEN** the server rejects the request as invalid and reads no client-named server path

#### Scenario: Concurrent audit is retryable
- **WHEN** a second execution/import is submitted while one audit worker is active
- **THEN** the server returns `409 audit_busy` with a retry hint and leaves the active audit undisturbed

### Requirement: File import is streamed, typed, capped, and cleaned up

`POST /api/v1/audits/import` SHALL stream the authenticated request body into a server-generated temporary file under the resolved Rasen machine-data area, enforce a 256 MiB maximum before/during receipt, and use only a sanitized basename/extension hint from the client. `.jsonl`, `.db`, and `.sqlite` imports SHALL be analyzed by the existing audit engine; supported audit-report `.json` imports SHALL be validated and copied into analytics under a collision-safe name. Temporary material SHALL be removed after success or failure.

#### Scenario: Supported source import
- **WHEN** an authenticated client uploads a supported source within the size cap
- **THEN** the server analyzes the uploaded bytes, saves the standard result under analytics, removes the temporary file, and returns report detail

#### Scenario: Supported report import
- **WHEN** an authenticated client uploads a valid supported audit-report JSON
- **THEN** the server persists it with a collision-safe analytics filename, returns its detail, and does not run transcript analysis

#### Scenario: Oversize body is stopped
- **WHEN** an upload declares or crosses the 256 MiB cap
- **THEN** the server stops accepting it, removes partial temporary material, returns 413, and creates no report

#### Scenario: Filename cannot escape the temporary directory
- **WHEN** the uploaded filename hint contains Windows or POSIX parent/path separators
- **THEN** the server reduces it to a safe type hint, uses a server-generated temporary name, and writes only beneath the machine-data temporary area

#### Scenario: Failure cleans temporary material
- **WHEN** audit parsing, report validation, request streaming, or persistence fails
- **THEN** the server returns the standard error and removes every temporary file created for that request

### Requirement: Saved reports are read from analytics without path escape

`GET /api/v1/audits` SHALL freshly list valid direct regular JSON reports in the resolved Rasen analytics directory and return newest-first descriptors plus a skipped-entry count. `GET /api/v1/audits/<report-id>` SHALL resolve exactly that direct basename, reject traversal and symlinks, revalidate the report schema, and return its descriptor plus report. An absent analytics directory SHALL be an empty successful list.

#### Scenario: Analytics files become the list
- **WHEN** native audit reports exist under the resolved analytics directory
- **THEN** the list endpoint returns their metadata newest first without requiring a separate index

#### Scenario: Absent analytics directory is empty
- **WHEN** the resolved analytics directory does not exist yet
- **THEN** the list endpoint returns an empty result and creates no files

#### Scenario: Traversal and symlink are rejected
- **WHEN** a report id attempts parent traversal, an absolute path, a nested path, or addresses a symlink
- **THEN** detail lookup rejects it and reads no file outside the direct analytics directory

#### Scenario: Cross-platform analytics resolution
- **WHEN** Rasen's global data directory is overridden or resolved on Windows, macOS, or Linux
- **THEN** list, detail, import, and execution consistently use its native `analytics` child directory
