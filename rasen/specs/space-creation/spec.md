# space-creation Specification

## Purpose
Define the management platform's space-creation write path: the CLI-backed subprocess bridge behind `POST /api/v1/spaces` — its input validation, deterministic CLI-verb selection, subprocess security model (argv, timeout, concurrency), and error-passthrough contract. The CLI remains the only entry point that ever writes workspace files or mints identity.

## Requirements

### Requirement: Spaces are created through the CLI only

The management server SHALL accept `POST /api/v1/spaces` with a JSON body `{ kind, path, id? }` where `kind` is `project` or `store` and `path` is an absolute filesystem path, and fulfil it exclusively by spawning the existing `rasen` CLI as a subprocess with an argv array and `shell: false`, resolved from the running server's own installation (never PATH). The server SHALL NOT write workspace files, mint identity, or modify any registry in-process. The CLI verb SHALL be selected deterministically: `kind: "project"` spawns `rasen init <path>`; `kind: "store"` spawns `rasen store register <path> --yes` (with `--id <id>` when provided) when the target directory already contains a `rasen/` directory, else `rasen store setup <id> --path <path>` (rejecting the request when `id` is missing in this branch). On success the server SHALL respond 201 with the operation performed and the new space's listing entry, re-read from the same enumeration `GET /api/v1/spaces` uses.

#### Scenario: Initialise a project space

- **WHEN** a client sends an authorized `POST /api/v1/spaces` with `{ kind: "project", path: <absolute dir> }`
- **THEN** the server spawns its own installation's CLI as `init <path>`, a real Rasen workspace exists at that path afterwards, and the response is 201 carrying the new project space entry
- **AND** a subsequent `GET /api/v1/spaces` lists the new project

#### Scenario: Register an existing store

- **WHEN** the target directory already contains a `rasen/` directory and a client sends `{ kind: "store", path, id: "team-store" }`
- **THEN** the server spawns `store register <path> --yes --id team-store`, the response reports the register operation, and the store appears in the spaces listing

#### Scenario: Create a fresh store

- **WHEN** the target directory contains no `rasen/` directory and a client sends `{ kind: "store", path, id: "team-store" }`
- **THEN** the server spawns `store setup team-store --path <path>` and responds 201 with the new store space entry

#### Scenario: Fresh store without an id is rejected before spawning

- **WHEN** a client sends `{ kind: "store", path }` for a directory with no `rasen/` directory and no `id`
- **THEN** the response is 400 with a validation error and no subprocess is spawned

#### Scenario: Windows path is handled canonically

- **WHEN** the `path` is an absolute Windows path differing from its canonical form by drive-letter case or separator form
- **THEN** the created/registered space resolves to one canonical entry (no duplicate space from a case variant)

### Requirement: Space creation validates input before spawning and passes CLI errors through

The server SHALL validate before any subprocess: `kind` MUST be `project` or `store`; `path` MUST be an absolute, control-character-free, length-capped path (a relative or option-like value is rejected — absoluteness itself guarantees the value cannot be parsed as a CLI option); `id`, when present, MUST satisfy the CLI's own store-id validation. Invalid input SHALL be rejected with 400 and no subprocess. All values SHALL be passed as discrete argv elements with `shell: false`; the subprocess working directory SHALL never derive from client input. When the subprocess exits non-zero the server SHALL respond 422 with the CLI's own error message (parsed from JSON output when available, otherwise stderr), the exit code, and captured stderr — never swallowed or paraphrased. A zero-exit subprocess whose resulting space cannot be found in the spaces listing SHALL produce a 500 protocol error rather than a fabricated success.

#### Scenario: Relative or option-like path rejected

- **WHEN** a client submits `path: "repo"` or `path: "--store=x"`
- **THEN** the response is 400 and no subprocess is spawned

#### Scenario: Invalid store id rejected

- **WHEN** a client submits an `id` that fails the CLI's store-id validation
- **THEN** the response is 400 naming the id constraint and no subprocess is spawned

#### Scenario: CLI refusal passes through verbatim

- **WHEN** the spawned CLI refuses (e.g. `init` in a repo whose planning is externalized to a store, or `store register` on an unhealthy root)
- **THEN** the response is 422 and its error message contains the CLI's own explanation plus the exit code

#### Scenario: Shell metacharacters are inert

- **WHEN** a submitted `path` or `id` contains shell metacharacters
- **THEN** either validation rejects it or the value is passed verbatim as one argv token, and no shell interpretation occurs

### Requirement: Space creation is whitelisted, bounded, and serialized

The three space-creation operations SHALL be rows in the management platform's data-driven admission whitelist, in the bounded-CLI tier (deterministic, bounded completion, no LLM or network dependency, no resident process, result observable through existing read endpoints), checked before every spawn. The server SHALL enforce a hard timeout (60 seconds) after which the subprocess is terminated (SIGTERM, then SIGKILL after a grace period) and the request answers 504. At most one space-creation subprocess SHALL be in flight per server; an overlapping request SHALL be rejected immediately with 409 `busy`. The endpoint SHALL require the same per-session bearer token as every management endpoint, with no CORS relaxation.

#### Scenario: Concurrent creation rejected

- **WHEN** a space-creation request arrives while another space-creation subprocess is still running
- **THEN** the second request responds 409 `busy` without spawning a subprocess

#### Scenario: Hung subprocess is bounded

- **WHEN** the spawned CLI exceeds the timeout (e.g. an unexpectedly interactive prompt)
- **THEN** the server terminates it and responds 504

#### Scenario: Whitelist is the single admission source

- **WHEN** the space-creation operations are removed from the whitelist table
- **THEN** the endpoint refuses to spawn (an internal error, not a silent bypass), proving the table is load-bearing

#### Scenario: Unauthenticated creation rejected

- **WHEN** a client sends `POST /api/v1/spaces` without a valid bearer token
- **THEN** the response is 401 and nothing is spawned
