## MODIFIED Requirements

### Requirement: Spaces are created through the CLI only

The management server SHALL accept `POST /api/v1/spaces` with exactly one explicit JSON operation: `{ op: "create-project", path }`, `{ op: "create-store", parent, id }`, or `{ op: "register-store", path, id? }`. It SHALL fulfil the request exclusively by spawning the existing `rasen` CLI as a subprocess with an argv array and `shell: false`, resolved from the running server's own installation (never PATH). The server SHALL NOT write workspace files, mint identity, or modify any registry in-process.

The operation SHALL deterministically select the CLI verb: `create-project` spawns `rasen init <path>`; `create-store` validates the id, joins it beneath the selected parent using the server platform's path semantics, and spawns `rasen store setup <id> --path <joined-root>`; `register-store` spawns `rasen store register <path> --yes` with `--id <id>` when provided. The server SHALL never inspect a create request's target and silently convert it to registration, or convert registration to setup. On success it SHALL respond 201 with the operation performed and the new space's listing entry, re-read from the same enumeration `GET /api/v1/spaces` uses.

#### Scenario: Initialise a project space

- **WHEN** a client sends an authorized `POST /api/v1/spaces` with `{ op: "create-project", path: <absolute dir> }`
- **THEN** the server spawns its own installation's CLI as `init <path>`, a real Rasen workspace exists at that path afterwards, and the response is 201 carrying the new project space entry
- **AND** a subsequent `GET /api/v1/spaces` lists the new project

#### Scenario: Register an existing store explicitly

- **WHEN** a client sends `{ op: "register-store", path: <existing Store root>, id: "team-store" }`
- **THEN** the server spawns `store register <path> --yes --id team-store`, reports the register operation, and lists the registered Store

#### Scenario: Create a fresh store beneath its selected parent

- **WHEN** a client sends `{ op: "create-store", parent: <absolute parent>, id: "team-store" }`
- **THEN** the server spawns `store setup team-store --path <parent joined with team-store>`, initializes the Store at that child root, and responds 201 with its listing entry

#### Scenario: Create never turns into registration

- **WHEN** the joined child of a `create-store` request already contains Store-like or conflicting content
- **THEN** the server still invokes Store setup and passes through any CLI refusal; it does not invoke Store registration

#### Scenario: Registration never turns into setup

- **WHEN** a `register-store` request points at a path the CLI does not accept as an existing Store
- **THEN** the server passes through the registration refusal and does not initialize that path

#### Scenario: Fresh store without an id is rejected before spawning

- **WHEN** a client sends a `create-store` request without an id
- **THEN** the response is 400 with a validation error and no subprocess is spawned

#### Scenario: Windows parent and id produce one child root

- **WHEN** `create-store` receives a canonical or case-variant absolute Windows parent and a valid id
- **THEN** setup receives the id joined directly beneath that parent with Windows path semantics, and the resulting Store resolves to one canonical listing entry

### Requirement: Space creation validates input before spawning and passes CLI errors through

The server SHALL validate before any subprocess: `op` MUST be one of `create-project`, `create-store`, or `register-store`; each `path` or `parent` MUST be an absolute, control-character-free, length-capped path; and each supplied `id` MUST satisfy the CLI's own Store-id validation. `create-store` SHALL require both parent and id, validate the id before deriving the child root, and derive that root with the platform path join operation. Fields from a different operation or an ambiguous legacy `{ kind, path, id? }` body SHALL be rejected with 400 rather than inferred. Invalid input SHALL spawn nothing.

All values SHALL be passed as discrete argv elements with `shell: false`; the subprocess working directory SHALL never derive from client input. When the subprocess exits non-zero the server SHALL respond 422 with the CLI's own error message (parsed from JSON output when available, otherwise stderr), the exit code, and captured stderr, never swallowed or paraphrased. A zero-exit subprocess whose resulting space cannot be found in the spaces listing SHALL produce a 500 protocol error rather than a fabricated success.

#### Scenario: Relative or option-like path rejected

- **WHEN** a client submits `path: "repo"`, `parent: "../stores"`, or an option-like path
- **THEN** the response is 400 and no subprocess is spawned

#### Scenario: Invalid store id rejected before joining

- **WHEN** a client submits a `create-store` id that fails the CLI Store-id validation
- **THEN** the response is 400 naming the id constraint, no target root is accepted, and no subprocess is spawned

#### Scenario: Ambiguous legacy body is rejected

- **WHEN** a client submits `{ kind: "store", path, id }` without an explicit operation
- **THEN** the response is 400 and filesystem state is not used to choose setup or registration

#### Scenario: CLI refusal passes through verbatim

- **WHEN** the spawned CLI refuses an explicit operation, such as project init in a pointer repo or registration of an unhealthy Store root
- **THEN** the response is 422 and its error message contains the CLI's own explanation plus the exit code

#### Scenario: Shell metacharacters are inert

- **WHEN** a submitted path, parent, or id contains shell metacharacters
- **THEN** either validation rejects it or the value is passed verbatim as one argv token, and no shell interpretation occurs
