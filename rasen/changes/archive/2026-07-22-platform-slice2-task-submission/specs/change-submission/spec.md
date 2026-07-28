# change-submission Specification (delta)

## ADDED Requirements

### Requirement: Change submission endpoint creates changes through the CLI only
The management server SHALL accept `POST /api/v1/changes` with a JSON body `{ name, description }` and fulfil it exclusively by spawning the existing `rasen` CLI as a subprocess (`new change <name> --proposal=<description> --json`), using an argv array with `shell: false`. The server SHALL NOT write workspace files directly and SHALL NOT reimplement any change-creation logic beyond pre-spawn input validation. On subprocess success the server SHALL respond 201 with the created change's id, path, and schema parsed from the CLI's JSON output. The CLI entry SHALL be resolved from the running server's own installation, not from PATH.

#### Scenario: Successful submission creates a real change
- **WHEN** a client sends an authorized `POST /api/v1/changes` with a valid name and description
- **THEN** the server spawns the CLI subprocess in the launch project, a real change directory with a seeded `proposal.md` exists on disk afterwards, and the response is 201 with the change id, path, and schema
- **AND** a subsequent `GET /api/v1/changes` lists the new change

#### Scenario: Submission without a launch project rejected before spawning
- **WHEN** the server was launched outside any Rasen project and a client sends `POST /api/v1/changes`
- **THEN** the server responds 409 with error code `no_project` and no subprocess is spawned

### Requirement: Whitelisted operations only, bounded by the slice boundary rule
The submission bridge SHALL admit only operations from a data-driven whitelist. In this slice the whitelist SHALL contain exactly one operation: create-change. An operation is eligible for the whitelist only if it terminates deterministically in bounded time without LLM or network dependency, leaves no resident process behind, and has its result observable through existing read endpoints. Long-running agent commands (auto runs, goal runs, claudecode sessions) SHALL NOT be admitted by this capability; admitting them requires the session-supervision capability (slice 3) to modify this requirement explicitly.

#### Scenario: Only the create-change operation exists
- **WHEN** the submission bridge's whitelist is enumerated
- **THEN** it contains exactly the create-change operation and no operation that spawns an agent session

### Requirement: Pre-spawn input validation and injection posture
The server SHALL validate submission input before spawning: the change name MUST satisfy the same kebab-case rule the CLI's change-name validation enforces, and the description MUST be non-empty, length-capped, and free of control characters other than tab (`\t`) and newline (`\n`), which are permitted since the description is natural multi-line proposal text. Invalid input SHALL be rejected with 400 and no subprocess. All values SHALL be passed as discrete argv elements (the description as a single `--proposal=<text>` token) so no client input is ever interpreted by a shell or parsed as an additional CLI option, regardless of embedded newlines.

#### Scenario: Shell metacharacters are inert
- **WHEN** a client submits a description containing shell metacharacters (quotes, semicolons, `$()`, backticks)
- **THEN** either validation rejects it or the text is passed verbatim as one argv token, and no shell interpretation occurs

#### Scenario: Option-like input cannot inject flags
- **WHEN** a client submits a name or description crafted to look like a CLI option (e.g. leading `--store`)
- **THEN** the name fails kebab-case validation with 400, and a description is bound into the single `--proposal=<text>` token, so no additional CLI option is parsed

#### Scenario: Multi-line description is accepted
- **WHEN** a client submits a description containing tab or newline characters
- **THEN** validation accepts it, the subprocess is spawned with the description bound verbatim (newlines included) into the single `--proposal=<text>` token, and the resulting `proposal.md` contains those newlines

#### Scenario: Invalid name rejected without subprocess
- **WHEN** a client submits a name with uppercase, spaces, or a leading hyphen
- **THEN** the server responds 400 with a validation error and spawns nothing

### Requirement: Subprocess confinement — cwd lock, timeout, concurrency cap
The submission subprocess SHALL run with its working directory locked to the server's launch project root; client input SHALL never influence the working directory or the executable path. The server SHALL enforce a hard timeout (30 seconds) after which the subprocess is terminated (SIGTERM, then SIGKILL after a grace period) and the request answers 504 `cli_timeout`. At most one write subprocess SHALL be in flight per server; an overlapping submission SHALL be rejected immediately with 409 `busy`.

#### Scenario: Concurrent submission rejected
- **WHEN** a submission arrives while another write subprocess is still running
- **THEN** the second request responds 409 with error code `busy` without spawning a subprocess

#### Scenario: Hung subprocess is bounded
- **WHEN** the spawned CLI process exceeds the timeout
- **THEN** the server terminates it and responds 504 with error code `cli_timeout`

### Requirement: CLI errors pass through verbatim
When the subprocess exits non-zero, the server SHALL respond 422 with an error envelope carrying the CLI's own error message (parsed from its JSON output when available, otherwise raw stderr), the exit code, and the captured stderr. The server SHALL NOT swallow, truncate to uselessness, or paraphrase CLI errors. A zero-exit subprocess whose output cannot be parsed as the expected JSON SHALL produce a 500 `cli_protocol_error` that includes the raw output.

#### Scenario: Duplicate change name surfaces the CLI error
- **WHEN** a client submits a name that already exists as a change
- **THEN** the response is 422 and its error message contains the CLI's own already-exists explanation, plus the subprocess exit code

#### Scenario: Stderr preserved on failure
- **WHEN** the subprocess fails with diagnostic output on stderr
- **THEN** the response envelope includes that stderr content

### Requirement: Write authentication and CSRF posture
`POST /api/v1/changes` SHALL require the same per-session bearer token as the read endpoints, presented in the `Authorization` header. Authentication SHALL never be cookie-based, so a cross-site form post cannot carry credentials and a cross-origin scripted request fails the CORS preflight (the server sets no CORS headers); no separate CSRF token is required under this model.

#### Scenario: Unauthenticated write rejected
- **WHEN** a client sends `POST /api/v1/changes` without a valid bearer token
- **THEN** the server responds 401 with the `unauthorized` error envelope and spawns nothing

#### Scenario: No CORS relaxation on the write path
- **WHEN** any response from `POST /api/v1/changes` is inspected
- **THEN** it carries no `Access-Control-Allow-Origin` header
