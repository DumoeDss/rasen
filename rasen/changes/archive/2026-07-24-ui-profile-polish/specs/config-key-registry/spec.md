# config-key-registry Delta

## MODIFIED Requirements

### Requirement: Declarative registry of settable configuration keys across three scopes

The system SHALL maintain a single declarative registry of every CLI-settable configuration key, where each entry declares the key path, the scopes it may be set in (any subset of `global`, `store`, and `project`), its value type (boolean, number, string, enum with allowed values, array, or the dual-form `threshold` type), any extra validation constraint, its built-in default, a one-line description, and a display group. Key validation for `config set`/`unset`, the interactive editor, the config HTTP API, and effective-config resolution SHALL all derive their key knowledge from this registry. The retired `delivery` key SHALL NOT appear in the registry as a settable key.

Scope assignment SHALL be: every key previously settable in both `global` and `project` scope (the `autopilot.gates`/`autopilot.selection` pair, `handoff.threshold` plus the five `handoff.roles.<role>` keys, and `models.default` plus the five `models.roles.<role>` keys) is settable in `global`, `store`, and `project`; every key previously project-only (`schema`, `archive.timing`, `archive.destination`) is settable in `store` and `project`; the `workflows` selection key is settable in `global` and `project` — a project-scope value is the space's own workflow selection override; the `profile` key is settable in `global` (the user-wide profile) and `project` (the space's profile lock, per the init-profile-lock behavior), with scope-dependent allowed values; the remaining machine-level global-only keys (`language`, `featureFlags.<name>`, `proactive`, `repoMode`, `telemetry.enabled`) remain global-only, including the `featureFlags` wildcard family.

#### Scenario: Registry drives set validation in every scope

- **WHEN** a key/value write is validated for scope `global`, `store`, or `project`
- **THEN** the key is accepted only if the registry lists it for that scope, and the value is validated against the registry's declared type and constraints before any file is written

#### Scenario: Store scope accepts the store-capable keys

- **WHEN** `handoff.threshold`, `schema`, or `archive.timing` is validated for the `store` scope
- **THEN** the key is accepted, with the same type and constraint checks as in project scope

#### Scenario: Global-only keys are rejected in store scope

- **WHEN** `profile`, `telemetry.enabled`, or a `featureFlags.<name>` entry is validated for the `store` scope
- **THEN** validation rejects the key as not settable in that scope

#### Scenario: Workflows key accepted at project scope and rejected at store scope

- **WHEN** `workflows` is validated for the `project` scope and then for the `store` scope
- **THEN** the project-scope write is accepted as an array value, and the store-scope write is rejected as not settable in that scope

#### Scenario: Rejection names the constraint

- **WHEN** a user sets `handoff.threshold` to `1.5` in any scope that lists it
- **THEN** the operation fails with a message stating the allowed range or the alternate absolute `{ remainingTokens: N }` form, and no config file is modified

#### Scenario: The threshold type accepts its dual form in every scope

- **WHEN** `handoff.threshold` (or a `handoff.roles.<role>` key) is set to `0.6` or to `{"remainingTokens": 60000}` at global, store, or project scope
- **THEN** both forms are accepted — a bare number as the fraction form, the object as the absolute form

#### Scenario: Retired delivery key is absent in every scope

- **WHEN** the registry is consulted, or `delivery` is validated for scope `global`, `store`, or `project`
- **THEN** the registry SHALL NOT include the retired `delivery` key, and validation rejects it as not settable (surfacing the retirement notice per the cli-config spec)

#### Scenario: Per-role model keys accept any model id in every scope

- **WHEN** a user sets `models.roles.reviewer` to `fable`, or `models.default` to `sonnet`, at global, store, or project scope
- **THEN** the value is accepted as a free-form string (no allow-list rejection), and an empty string is rejected with a message that a model id is required

#### Scenario: Registry keys stay consistent with the parse schemas

- **WHEN** the test suite runs
- **THEN** a test asserts every registry key round-trips through the config schema of each scope it declares — store-scoped entries validating against the same schema that parses a planning root's `rasen/config.yaml` — so the registry and the schemas cannot drift silently

## ADDED Requirements

### Requirement: The profile key's allowed values are scope-aware and include saved profiles

The `profile` key SHALL validate against a scope-dependent value set. At `global` scope the allowed values SHALL be `full`, `core`, `custom`, and every saved profile name on the machine — the user-wide profile can name a saved profile. At `project` scope the allowed values SHALL be `full`, `core`, and every saved profile name — `custom` remains excluded because a lock needs a stable referent. Scope-aware validation SHALL govern every write path that knows its scope (CLI `config set`, the interactive editor, and the config HTTP API), and the saved-name portion of both sets SHALL reflect the profiles saved at validation time.

#### Scenario: Global scope accepts a saved profile name

- **WHEN** a saved profile `my-set` exists and `profile` is set to `my-set` at `global` scope
- **THEN** the write is accepted and persisted

#### Scenario: Custom is global-only

- **WHEN** `profile` is set to `custom` at `global` scope and then at `project` scope
- **THEN** the global write is accepted and the project write is rejected with the allowed values named

#### Scenario: Unknown names are rejected in both scopes

- **WHEN** `profile` is set to a name that is neither reserved nor a saved profile, in either scope
- **THEN** validation rejects the value with a message listing the allowed values
