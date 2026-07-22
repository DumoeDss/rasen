# config-key-registry Delta Specification

## ADDED Requirements

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
