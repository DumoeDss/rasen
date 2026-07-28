# config-http-api Delta Specification

## REMOVED Requirements

### Requirement: Localhost config API endpoints

**Reason**: Read responses gain the store layer — sources include `store`, raw per-scope values include `store`, and responses name the store contributing the store layer. Replaced by "Localhost config API endpoints with store-layer visibility".
**Migration**: Existing clients keep working: the new response fields are additive JSON; `?project=` addressing is unchanged.

### Requirement: Scope-explicit, registry-validated writes

**Reason**: Writes gain the `store` scope (valid only when the addressed space is a store). Replaced by "Scope-explicit writes across global, store, and project scopes".
**Migration**: Existing `global`/`project` writes behave identically; clients that never send `scope: "store"` are unaffected.

## ADDED Requirements

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

### Requirement: Scope-explicit writes across global, store, and project scopes

Every write (set or unset) SHALL require an explicit `scope` of `global`, `store`, or `project`; a missing or invalid scope SHALL be rejected without any write. Writes in ALL scopes SHALL validate the key path and value through the config-key registry (including the machine-managed not-settable keys) before touching any file, and global writes SHALL additionally pass global schema validation before saving. A `store`-scope write SHALL be accepted only when the request addresses a store space, and SHALL land in that store's own `rasen/config.yaml` through the same comment-preserving write path as project writes; a `store`-scope write addressed at a project (or with no addressable store) SHALL be rejected with guidance to address the store space. A `project`-scope write addressed at a store space SHALL be rejected with guidance to use the `store` scope. When a key is not settable in the requested scope but is settable in another, the error SHALL name the scopes the key is settable in. Errors SHALL use a uniform shape `{ error: { code, message, fix? } }`.

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
