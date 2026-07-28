# config-key-registry Delta

## MODIFIED Requirements

### Requirement: Declarative registry of settable configuration keys across three scopes

The system SHALL maintain a single declarative registry of every CLI-settable configuration key, where each entry declares the key path, the scopes it may be set in (any subset of `global`, `store`, and `project`), its value type (boolean, number, string, enum with allowed values, array, or the dual-form `threshold` type), any extra validation constraint, its built-in default, a one-line description, and a display group. Key validation for `config set`/`unset`, the interactive editor, the config HTTP API, and effective-config resolution SHALL all derive their key knowledge from this registry. The retired `delivery` key SHALL NOT appear in the registry as a settable key.

Scope assignment SHALL be: every key previously settable in both `global` and `project` scope (the `autopilot.gates`/`autopilot.selection` pair, `handoff.threshold` plus the five `handoff.roles.<role>` keys, and `models.default` plus the five `models.roles.<role>` keys) is settable in `global`, `store`, and `project`; every key previously project-only (`schema`, `archive.timing`, `archive.destination`) is settable in `store` and `project`; the `workflows` selection key is settable in `global` and `project` — a project-scope value is the space's own workflow selection override; the `profile` key is settable in `global` and `project` — the global scope keeps its `full`/`core`/`custom` values, while a project-scope value is the project's locked profile and accepts `full`, `core`, or a saved profile name (never `custom`); the remaining machine-level global-only keys (`language`, `featureFlags.<name>`, `proactive`, `repoMode`, `telemetry.enabled`) remain global-only, including the `featureFlags` wildcard family.

#### Scenario: Registry drives set validation in every scope

- **WHEN** a key/value write is validated for scope `global`, `store`, or `project`
- **THEN** the key is accepted only if the registry lists it for that scope, and the value is validated against the registry's declared type and constraints before any file is written

#### Scenario: Store scope accepts the store-capable keys

- **WHEN** `handoff.threshold`, `schema`, or `archive.timing` is validated for the `store` scope
- **THEN** the key is accepted, with the same type and constraint checks as in project scope

#### Scenario: Machine-level keys are rejected in store scope

- **WHEN** `profile`, `telemetry.enabled`, or a `featureFlags.<name>` entry is validated for the `store` scope
- **THEN** validation rejects the key as not settable in that scope

#### Scenario: Workflows key accepted at project scope and rejected at store scope

- **WHEN** `workflows` is validated for the `project` scope and then for the `store` scope
- **THEN** the project-scope write is accepted as an array value, and the store-scope write is rejected as not settable in that scope

#### Scenario: Profile key accepted at project scope with project-scope values

- **WHEN** `profile` is validated for the `project` scope with value `core` or the name of a saved profile
- **THEN** the write is accepted
- **WHEN** `profile` is validated for the `project` scope with value `custom`
- **THEN** validation rejects the value naming the allowed project-scope values

#### Scenario: Project-scope profile write rejects an unknown named profile

- **WHEN** `rasen config set profile no-such-profile --scope project` runs and no saved definition with that name exists on this machine
- **THEN** the write is rejected naming the unknown profile and listing the available profiles, and no file is modified

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
