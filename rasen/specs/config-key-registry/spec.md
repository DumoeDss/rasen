# config-key-registry Specification

## Purpose
Defines a single declarative registry of every CLI-settable configuration key — its path, scopes, type, constraints, default, description, and display group — so that `config set`/`unset`, the interactive editor, and effective-config resolution all derive their key knowledge from one source and cannot drift from the parse schemas.

## Requirements

### Requirement: Declarative registry of settable configuration keys across three scopes

The system SHALL maintain a single declarative registry of every CLI-settable configuration key, where each entry declares the key path, the scopes it may be set in (any subset of `global`, `store`, and `project`), its value type (boolean, number, string, enum with allowed values, array, or the dual-form `threshold` type), any extra validation constraint, its built-in default, a one-line description, and a display group. Key validation for `config set`/`unset`, the interactive editor, the config HTTP API, and effective-config resolution SHALL all derive their key knowledge from this registry.

Scope assignment SHALL be: every key previously settable in both `global` and `project` scope (the `autopilot.gates`/`autopilot.selection` pair, `handoff.threshold` plus the five `handoff.roles.<role>` keys, and `models.default` plus the five `models.roles.<role>` keys) is settable in `global`, `store`, and `project`; every key previously project-only (`schema`, `archive.timing`, `archive.destination`) is settable in `store` and `project`; the machine-level global-only keys (`profile`, `delivery`, `workflows`, `language`, `featureFlags.<name>`, `proactive`, `repoMode`, `telemetry.enabled`) remain global-only, including the `featureFlags` wildcard family.

#### Scenario: Registry drives set validation in every scope

- **WHEN** a key/value write is validated for scope `global`, `store`, or `project`
- **THEN** the key is accepted only if the registry lists it for that scope, and the value is validated against the registry's declared type and constraints before any file is written

#### Scenario: Store scope accepts the store-capable keys

- **WHEN** `handoff.threshold`, `schema`, or `archive.timing` is validated for the `store` scope
- **THEN** the key is accepted, with the same type and constraint checks as in project scope

#### Scenario: Global-only keys are rejected in store scope

- **WHEN** `profile`, `telemetry.enabled`, or a `featureFlags.<name>` entry is validated for the `store` scope
- **THEN** validation rejects the key as not settable in that scope

#### Scenario: Rejection names the constraint

- **WHEN** a user sets `handoff.threshold` to `1.5` in any scope that lists it
- **THEN** the operation fails with a message stating the allowed range or the alternate absolute `{ remainingTokens: N }` form, and no config file is modified

#### Scenario: The threshold type accepts its dual form in every scope

- **WHEN** `handoff.threshold` (or a `handoff.roles.<role>` key) is set to `0.6` or to `{"remainingTokens": 60000}` at global, store, or project scope
- **THEN** both forms are accepted — a bare number as the fraction form, the object as the absolute form

#### Scenario: Per-role model keys accept any model id in every scope

- **WHEN** a user sets `models.roles.reviewer` to `fable`, or `models.default` to `sonnet`, at global, store, or project scope
- **THEN** the value is accepted as a free-form string (no allow-list rejection), and an empty string is rejected with a message that a model id is required

#### Scenario: Registry keys stay consistent with the parse schemas

- **WHEN** the test suite runs
- **THEN** a test asserts every registry key round-trips through the config schema of each scope it declares — store-scoped entries validating against the same schema that parses a planning root's `rasen/config.yaml` — so the registry and the schemas cannot drift silently

### Requirement: Pinned-spaces preference key

The configuration key registry SHALL include `ui.pinnedSpaces` as a global-only key of array type with an empty-array default: the user's pinned planning spaces as `<type>:<id>` space selectors, readable and writable through the standard registry-validated paths (`rasen config set/unset --scope global`, the config HTTP API's global writes) like any other global key. The key SHALL validate against the global config schema (a typed `ui` block), and surfaces that cannot meaningfully edit an array in place (the CLI interactive editor, the web Config page's generic rows) SHALL present it read-only with a pointer to the Spaces page rather than failing.

#### Scenario: Pins round-trip through the config API

- **WHEN** a client PUTs `ui.pinnedSpaces` with `scope: "global"` and value `["store:team-store", "project:api"]`
- **THEN** the write is accepted, lands in the global config, and a subsequent read returns the array with source `global`

#### Scenario: Non-array value rejected

- **WHEN** a write sets `ui.pinnedSpaces` to a string or object
- **THEN** the write is rejected by registry validation naming the array type, and no file is modified

#### Scenario: Key is global-only

- **WHEN** `ui.pinnedSpaces` is validated for a non-global scope
- **THEN** validation rejects it as not settable in that scope

#### Scenario: Registry round-trip covers the new key

- **WHEN** the test suite runs
- **THEN** the registry consistency test asserts `ui.pinnedSpaces` is accepted by the global config schema, so the registry and schema cannot drift

#### Scenario: Editors degrade to read-only

- **WHEN** the CLI interactive editor or the web Config page renders `ui.pinnedSpaces`
- **THEN** the row is presented read-only (with guidance that pins are managed from the Spaces page), not an error or a crash
