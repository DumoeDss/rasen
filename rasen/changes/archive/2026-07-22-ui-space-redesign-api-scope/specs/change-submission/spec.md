## MODIFIED Requirements

### Requirement: Subprocess confinement — cwd lock, timeout, concurrency cap
The submission subprocess SHALL run with its working directory locked to the planning root of the server-resolved space: the space named by the request's optional `space` selector (per the planning-space-addressing capability), or the server's launch project root when no selector is given. Client input SHALL never supply a working directory as free text — a `space` selector only ever resolves through the machine registries, and an unresolvable selector rejects the request before any subprocess exists. Client input SHALL never influence the executable path. The server SHALL enforce a hard timeout (30 seconds) after which the subprocess is terminated (SIGTERM, then SIGKILL after a grace period) and the request answers 504 `cli_timeout`. At most one write subprocess SHALL be in flight per server; an overlapping submission SHALL be rejected immediately with 409 `busy`.

#### Scenario: Concurrent submission rejected
- **WHEN** a submission arrives while another write subprocess is still running
- **THEN** the second request responds 409 with error code `busy` without spawning a subprocess

#### Scenario: Hung subprocess is bounded
- **WHEN** the spawned CLI process exceeds the timeout
- **THEN** the server terminates it and responds 504 with error code `cli_timeout`

#### Scenario: Submission lands in the selected space
- **WHEN** a client sends `POST /api/v1/changes` with a valid body and `space=store:<id>` for a healthy registered store
- **THEN** the CLI subprocess runs with the store's planning root as its working directory and the created change appears under that store's `rasen/changes/`

#### Scenario: Unresolvable space rejects before spawning
- **WHEN** a submission carries a `space` selector that does not resolve
- **THEN** the server responds with the space resolution error and no subprocess is spawned

#### Scenario: Working directory is never client free text
- **WHEN** a submission attempts to smuggle a filesystem path as its space selector without the selector resolving through a registry namespace
- **THEN** the request is rejected and no subprocess runs with a client-supplied path as its working directory
