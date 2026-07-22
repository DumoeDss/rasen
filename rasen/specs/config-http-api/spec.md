# config-http-api Specification

## Purpose

This spec defines the localhost HTTP JSON API the CLI embeds to expose the unified configuration layer to a browser-based UI. It governs how configuration keys are listed, read, set, and unset over HTTP, how projects are addressed, and how the server is secured to loopback with a per-session token. All endpoint behavior draws from the in-process unified config layer with no configuration logic reimplemented in HTTP handlers.
## Requirements
### Requirement: Localhost config API endpoints with store-layer visibility

The CLI SHALL embed a localhost HTTP JSON API, versioned under `/api/v1/`, exposing the unified configuration layer: a health probe, a list endpoint returning every registered configuration key with its definition metadata, effective value, source (`default` | `global` | `store` | `project` | `env-override`), and raw per-scope values (`global`, `store`, `project`); a single-key get; scope-explicit set and unset that return the re-resolved entry; and a registered-projects listing. List and single-key responses SHALL additionally report the store contributing the store layer as a `store` reference (id and root) or null — the inherited store when a project context is addressed, the space's own store when a store space is addressed. The projects listing SHALL omit registry entries whose root directory no longer exists on disk, read-only, exactly as before. All endpoint data SHALL come from the unified config layer's in-process modules with no configuration logic reimplemented in HTTP handlers.

#### Scenario: List returns effective entries with sources

- **WHEN** a client sends `GET /api/v1/config` with a valid token
- **THEN** the response contains one entry per non-wildcard registered key with its effective value, source annotation, and raw global/store/project scope values

#### Scenario: Inherited store layer is visible to a plain project read

- **WHEN** the addressed project declares `store: team-store` beside local planning, `team-store` is registered and sets `models.default`, and the client uses the pre-existing `?project=` addressing
- **THEN** the entry for `models.default` carries the store's value in the raw store-scope values, and the response's `store` reference names `team-store`

#### Scenario: No store noise without inheritance

- **WHEN** the addressed project declares no `store:` pointer
- **THEN** the response's `store` reference is null and no entry reports a raw store-scope value

#### Scenario: Invalid on-disk store values are reported, not rewritten

- **WHEN** the active store layer's config carries a value failing registry validation (e.g. `handoff.threshold: 5`)
- **THEN** list/get responses carry a warning on that entry identifying the invalid on-disk store value, and the API never rewrites the file

#### Scenario: Get a single key
- **WHEN** a client sends `GET /api/v1/config/handoff.threshold`
- **THEN** the response contains that key's effective entry
- **AND** an unregistered key yields 404 with error code `unknown_key`

#### Scenario: Set re-resolves and returns the entry
- **WHEN** a client sends `PUT /api/v1/config/handoff.threshold` with body `{ "scope": "project", "value": 0.4 }` addressing a project
- **THEN** the project's `rasen/config.yaml` is updated through the comment-preserving write path
- **AND** the response contains the re-resolved entry showing value 0.4 with source `project`

#### Scenario: Unset reverts to the lower layer
- **WHEN** a client sends `DELETE /api/v1/config/handoff.threshold?scope=project` for a project where a global value is also set
- **THEN** the key is removed from the project config
- **AND** the returned entry shows the global value with source `global`

#### Scenario: Health and projects endpoints
- **WHEN** a client sends `GET /api/v1/health` or `GET /api/v1/projects`
- **THEN** health returns ok plus the CLI version and the launch project reference (or null)
- **AND** projects returns the machine project registry's live entries as `{ projectId, name, root }` references

#### Scenario: Dead project roots are hidden without registry writes
- **WHEN** a registered project's root directory has been deleted from disk
- **THEN** `GET /api/v1/projects` omits that entry
- **AND** the registry file is left byte-for-byte unchanged by the request

### Requirement: Scope-explicit writes across global, store, and project scopes

Every write (set or unset) SHALL require an explicit `scope` of `global`, `store`, or `project`; a missing or invalid scope SHALL be rejected without any write. Writes in ALL scopes SHALL validate the key path and value through the config-key registry (including the machine-managed not-settable keys) before touching any file, and global writes SHALL additionally pass global schema validation before saving. A `store`-scope write SHALL be accepted only when the request addresses a store space, and SHALL land in that store's own `rasen/config.yaml` through the same comment-preserving write path as project writes; a `store`-scope write addressed at a project (or with no addressable store) SHALL be rejected with guidance to address the store space. A `project`-scope write addressed at a store space SHALL be rejected with guidance to use the `store` scope. When a key is not settable in the requested scope but is settable in another, the error SHALL name the scopes the key is settable in. Errors SHALL use a uniform shape `{ error: { code, message, fix? } }`.

#### Scenario: Missing scope is rejected
- **WHEN** a PUT arrives without a `scope` field
- **THEN** the response is 400 with an error code identifying the missing scope
- **AND** no config file is modified

#### Scenario: Registry validation applies to global writes
- **WHEN** a PUT sets `repoMode` to an out-of-enum value with `scope: "global"`
- **THEN** the response is 400 with error code `invalid_value` and a message listing the allowed values
- **AND** the global config file is not modified

#### Scenario: Global write touches only the target key
- **WHEN** a PUT sets one global key on a config file that omits other keys with built-in defaults
- **THEN** after the write, the file contains the new key value and the previously present content only
- **AND** keys never explicitly set remain absent from the file (their source annotation stays `default`)

#### Scenario: Store write lands in the store's own config

- **WHEN** a PUT sets `handoff.threshold` with `scope: "store"` on a request addressing a registered store space
- **THEN** the store's own `rasen/config.yaml` is updated through the comment-preserving write path
- **AND** the returned re-resolved entry shows the value with source `store`

#### Scenario: Store write rejected outside a store space

- **WHEN** a PUT carries `scope: "store"` while addressing a project (or nothing)
- **THEN** the response is 400 with an error identifying the scope as invalid for the addressed space and a fix pointing at addressing the store space
- **AND** no config file is modified

#### Scenario: Project write rejected at a store space

- **WHEN** a PUT carries `scope: "project"` while addressing a store space
- **THEN** the response is 400 with a fix directing the client to `scope: "store"`, and no file is modified

#### Scenario: Wrong-scope error names the settable scopes

- **WHEN** a PUT targets `profile` (global-only) with `scope: "store"`
- **THEN** the response is 400 with an error naming `global` as the scope the key is settable in

#### Scenario: Unset in store scope reverts to the lower layer

- **WHEN** a DELETE removes `models.default` with `scope=store` at a store space where a global value is also set
- **THEN** the key is removed from the store's config and the returned entry shows the global value with source `global`

#### Scenario: Machine-managed keys stay not settable

- **WHEN** a PUT targets `telemetry.anonymousId` in any scope
- **THEN** the response is 400 with error code `not_settable` and the stored value is unchanged

### Requirement: Planning-space addressing on config endpoints

Config read and write endpoints SHALL additionally accept the management API's `space` selector (query or body): `project:<selector>` resolves exactly like the existing `project` selector, and `store:<id>` addresses a registered store by id. A request carrying both `space` and `project` selectors SHALL be rejected without side effects. When a store space is addressed, resolution SHALL present the store's own values as the store layer with the raw project-layer values absent. Space selector errors SHALL match the management API's vocabulary (400 `invalid_space` for a missing prefix, 404 `space_not_found`, 409 `space_unavailable`). Omitting both selectors SHALL keep the launch-project fallback byte-compatible, and the existing `project` selector SHALL keep working unchanged.

#### Scenario: Store space read

- **WHEN** a client sends `GET /api/v1/config?space=store:team-store` for a healthy registered store
- **THEN** entries report the store's own config values in the raw store-scope values with no raw project-scope values, and store-settable keys set there resolve with source `store`

#### Scenario: Project space selector is equivalent to project addressing

- **WHEN** a client sends `GET /api/v1/config?space=project:<projectId>` for a registered project
- **THEN** the response matches `GET /api/v1/config?project=<projectId>` for the same project

#### Scenario: Conflicting selectors are rejected

- **WHEN** a request carries both `space` and `project` selectors
- **THEN** the response is 400 and no handler logic or write runs

#### Scenario: Space selector errors match the management vocabulary

- **WHEN** a config request carries `space=team-store` (no prefix) or `space=store:missing` (unregistered)
- **THEN** the response is 400 `invalid_space` or 404 `space_not_found` respectively, matching the management API's space addressing behavior

### Requirement: Project addressing
Read and write endpoints SHALL accept an optional project selector (query `project` or body `project`) naming a registered project by project id or by absolute root path, resolved against the machine project registry. When the selector is omitted, the server's launch project (the Rasen root resolved at server startup, possibly none) SHALL apply. An unresolvable selector SHALL yield 404 with error code `project_not_found` and a fix hint; a project-scope write with no resolvable project SHALL be rejected rather than silently falling back to global scope.

#### Scenario: Address a project by id
- **WHEN** a GET or PUT carries `project=<projectId>` for a project present in the machine registry
- **THEN** project-layer values resolve from and writes land in that project's `rasen/config.yaml`

#### Scenario: Unknown project selector
- **WHEN** a request carries a `project` selector matching no registry entry by id or canonical root path
- **THEN** the response is 404 with error code `project_not_found` and guidance to open the project with the CLI once

#### Scenario: Project write without a project
- **WHEN** the server was launched outside any Rasen project and a PUT arrives with `scope: "project"` and no `project` selector
- **THEN** the response is an error explaining that a project must be selected
- **AND** no global write occurs

### Requirement: Loopback-only bind with per-session token guard
The API server SHALL bind exclusively to the loopback interface (127.0.0.1) on an ephemeral port by default. At startup the CLI SHALL mint a random per-session token; every `/api/` request SHALL present it as a bearer Authorization header or receive 401. The server SHALL emit no CORS headers, and mutating requests SHALL additionally require an `application/json` content type. The token SHALL be conveyed to the browser via the opened URL's fragment rather than logged query strings.

#### Scenario: Loopback bind
- **WHEN** the server starts
- **THEN** it listens on 127.0.0.1 only and is not reachable from other interfaces

#### Scenario: Missing or wrong token
- **WHEN** an `/api/` request arrives without the session token or with an incorrect one
- **THEN** the response is 401 with error code `unauthorized` and no handler logic runs

#### Scenario: Cross-origin form post is rejected
- **WHEN** a mutating request arrives without an `application/json` content type
- **THEN** the request is rejected before any write

### Requirement: Read-only pipelines inventory endpoint
The CLI SHALL expose a read-only `GET /api/v1/pipelines` endpoint returning the available pipelines and, for each, the stages that carry a gate, so a client can render a gates inventory. Each pipeline SHALL report its `name`, `description`, and a `stages` list; each stage SHALL report its `id`, `role` (or null), `skill` (or null), and its gate value as `false`, `true`, or `'vet'`. The endpoint SHALL be GET-only (any other method yields 405) and SHALL draw its data from the same in-process pipeline registry loader the CLI uses, with no pipeline logic reimplemented in the handler. The endpoint SHALL require the session token exactly like the other `/api/` endpoints.

#### Scenario: Pipelines endpoint returns gated-stage metadata
- **WHEN** a client sends `GET /api/v1/pipelines` with a valid token
- **THEN** the response lists each available pipeline with its stages, and each stage carries its `id`, `role`, `skill`, and gate value (`false`, `true`, or `'vet'`)

#### Scenario: The vet gate is distinguishable in the response
- **WHEN** a pipeline contains a stage marked `gate: 'vet'`
- **THEN** that stage's gate value in the response is the string `'vet'`, distinct from an ordinary `true` gate, so a client can mark it as always-pausing

#### Scenario: Non-GET methods are rejected
- **WHEN** a client sends a `PUT`, `POST`, or `DELETE` to `/api/v1/pipelines`
- **THEN** the response is 405 with error code `method_not_allowed` and no state changes

#### Scenario: Token guard applies
- **WHEN** a request to `/api/v1/pipelines` arrives without the session token or with an incorrect one
- **THEN** the response is 401 with error code `unauthorized` and no handler logic runs

