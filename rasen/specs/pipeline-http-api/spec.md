# pipeline-http-api Specification

## Purpose
Provide a loopback-bound, bearer-secured HTTP surface over the pipelines available to an addressed planning space — inventory with effective per-stage configuration, and CLI-backed mutation (import, init, export, delete) — served under the management-http-api security posture. This capability takes over and extends the pipelines endpoint contract that previously lived in `config-http-api`, mirroring the workflow-http-api mutation-bridge pattern.

## Requirements

### Requirement: Pipelines inventory endpoint with effective stage configuration

The server SHALL serve `GET /api/v1/pipelines` returning the pipelines available to the addressed space: the endpoint SHALL accept the management `space` selector exactly like the config endpoints (project and store selectors, launch-project fallback when omitted, the same space-error vocabulary), resolving the space's own root as the project layer of pipeline resolution. Each pipeline SHALL report its `name`, `description`, provenance (built-in or user), and resolved source layer (project, user, or package); each stage SHALL report its `id`, `role` (or null), `skill` (or null), its declared gate value as `false`, `true`, or `'vet'`, and its EFFECTIVE gate, model, handoff threshold, and runtime — each effective value carrying the source layer that supplied it, computed by the same in-process resolvers the CLI's `pipeline show` uses, with no resolution logic reimplemented in the handler. The endpoint SHALL require the session token like every management path.

#### Scenario: Effective values with sources

- **WHEN** a per-stage model override is set at project scope and a client sends `GET /api/v1/pipelines?space=project:<id>`
- **THEN** that stage reports the override as its effective model with a per-stage project source, while its declared fields are unchanged

#### Scenario: Space addressing resolves the project layer

- **WHEN** a pipeline exists only in one project's `rasen/pipelines/` and two different spaces are addressed
- **THEN** the pipeline appears only in the owning space's response, and user/package pipelines appear in both

#### Scenario: The vet gate is distinguishable in the response

- **WHEN** a pipeline contains a stage marked `gate: 'vet'`
- **THEN** that stage's declared gate value in the response is the string `'vet'`, distinct from an ordinary `true` gate, so a client can mark it as always-pausing

#### Scenario: Mask reflected in effective gates

- **WHEN** `autopilot.gates` resolves `off` for the addressed space and one stage has a per-stage gate `on` instance
- **THEN** that stage's effective gate is on and every other ordinary gate reports off, each naming its deciding layer

#### Scenario: Token guard applies

- **WHEN** a request to `/api/v1/pipelines` arrives without the session token or with an incorrect one
- **THEN** the response is 401 with error code `unauthorized` and no handler logic runs

### Requirement: Pipeline mutations run through a whitelisted CLI bridge

`POST /api/v1/pipelines` SHALL accept exactly four operations discriminated by an `op` field — `import` (a source path with an optional overwrite flag), `init` (a new name and an output path), `export` (a name, a destination path, and an optional overwrite flag), and `delete` (a name with an optional force flag) — performing each exclusively by spawning the existing CLI as a subprocess under the shared admission whitelist's bounded-CLI tier; the server writes no library or workspace file itself. The bridge SHALL run at most one pipeline subprocess at a time (409 for a concurrent request), bound the subprocess with a timeout and reliable termination, return the CLI's own error message verbatim with 422 on failure, and reject an unknown `op` with 400 spawning nothing. Every client-supplied filesystem path SHALL be required absolute (400 otherwise, before any spawn), every pipeline name SHALL be validated against the identifier form pipeline names accept and rejected when option-shaped, and every input SHALL be passed as a single argument token, never through a shell. Delete SHALL always run the CLI's non-interactive confirmed form (client-side confirmation), pass force only when flagged, and a delete targeting a built-in pipeline SHALL be refused with the CLI's refusal passed through. PUT and DELETE methods on the path SHALL be rejected with 405.

#### Scenario: Import installs via the CLI

- **WHEN** a client submits `{ op: 'import', path: <absolute path to a .rasenpkg> }`
- **THEN** the pipeline is installed by a spawned CLI subprocess and the response reports the CLI's own result

#### Scenario: Relative path or option-shaped name rejected before spawn

- **WHEN** a client submits a relative `path` on any operation, or a `name` beginning with `-`
- **THEN** the response is 400 and no subprocess is spawned

#### Scenario: Built-in delete refused

- **WHEN** a client submits `{ op: 'delete', name: <a built-in pipeline>, force: true }`
- **THEN** the response is 422 carrying the CLI's refusal and the pipeline remains available

#### Scenario: Concurrent mutation refused

- **WHEN** a second mutation arrives while a pipeline subprocess is in flight
- **THEN** the response is 409 busy and no second subprocess is spawned

#### Scenario: Windows and POSIX absolute forms both accepted

- **WHEN** a client submits an absolute path in the platform's native form (such as `E:\packages\pipe.rasenpkg` on Windows)
- **THEN** the guard accepts it and the CLI receives it unchanged as one argument
