# config-key-registry Specification

## Purpose
Defines a single declarative registry of every CLI-settable configuration key — its path, scopes, type, constraints, default, description, and display group — so that `config set`/`unset`, the interactive editor, and effective-config resolution all derive their key knowledge from one source and cannot drift from the parse schemas.
## Requirements
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

### Requirement: Wildcard configuration key families including the pipeline runtime namespace

The registry SHALL support wildcard key families: entries declaring a fixed-shape dot-path pattern with literal and placeholder segments, the scopes instances may be set in, a value type with constraints, a display group, and optionally a default. A key path SHALL match a family exactly when its segment count equals the pattern's and every literal segment matches; each placeholder segment SHALL be validated structurally as a conservative identifier (letters, digits, hyphen, underscore), and SHALL NOT be validated against the existence of any pipeline, stage, role, or other referent — a well-formed instance for an unknown referent is accepted and inert. A path matching a family's literals but not its shape SHALL be rejected with a message naming the family's pattern. Family instances SHALL validate their values against the family's declared type and constraints in every declared scope, exactly like fixed keys.

The registry SHALL declare five families:
- `featureFlags.<name>` — boolean, global scope only, default false: its existing behavior is preserved byte-for-byte through the general mechanism, with no parallel special case remaining.
- `pipelines.<name>.gates.<stage>` — enum `on` | `off`, settable at global, store, and project scope.
- `pipelines.<name>.models.<stage>` — a model id (any non-empty string, no allow-list), settable at global, store, and project scope.
- `pipelines.<name>.handoff.<stage>` — the dual-form threshold (a fraction, or `{ remainingTokens: N }`), settable at global, store, and project scope.
- `pipelines.<name>.runtimes.<role>` — enum `claude` | `codex`, settable at global, store, and project scope.

The four `pipelines.*` families SHALL declare no default value: an unset instance is absent, not defaulted. A set instance SHALL round-trip through the configuration schema of every scope its family declares (the global config and a planning root's `rasen/config.yaml` both admit the `pipelines` block), and instance values failing validation on disk SHALL be reported as warnings and ignored, never rewritten. Effective resolution SHALL surface every set instance as an entry carrying its full instance key, its per-scope raw values, and the standard precedence (project over store over global) gated by the family's scopes; the family definition itself SHALL remain visible as a template entry.

#### Scenario: Runtime family instance validates in all three scopes

- **WHEN** `pipelines.small-feature.runtimes.reviewer` is validated for scope `global`, `store`, or `project` with value `codex`
- **THEN** the key and value are accepted, and a value outside `claude`/`codex` is rejected naming the allowed values

#### Scenario: Pipelines family instance validates in all three scopes

- **WHEN** `pipelines.small-feature.gates.propose` is validated for scope `global`, `store`, or `project` with value `on`
- **THEN** the key and value are accepted, and a value outside `on`/`off` is rejected naming the allowed values

#### Scenario: Wrong-shape family path is rejected naming the pattern

- **WHEN** `pipelines.small-feature.runtimes` (missing the role segment) or `pipelines.small-feature.gates.propose.extra` is validated in any scope
- **THEN** validation rejects it with a message naming the family's shape

#### Scenario: Unknown referents are accepted structurally

- **WHEN** `pipelines.no-such-pipeline.runtimes.no-such-role` is set to `claude` in a declared scope
- **THEN** the write is accepted (a well-formed instance for an unknown referent is inert), and a placeholder segment containing a character outside letters, digits, hyphen, or underscore is rejected

#### Scenario: Threshold family accepts the dual form

- **WHEN** `pipelines.bug-fix.handoff.review` is set to `0.6` or to `{"remainingTokens": 60000}` at any of global, store, or project scope
- **THEN** both forms are accepted, and `1.5` is rejected naming the range and the alternate absolute form

#### Scenario: featureFlags behavior is unchanged through the general mechanism

- **WHEN** `featureFlags.someFlag` is validated with a boolean at global scope, with a non-boolean value, with a third segment, or at store scope
- **THEN** the boolean is accepted, the non-boolean is rejected, the third segment is rejected, and the store scope is rejected as not settable — identical to the behavior before the family mechanism existed

#### Scenario: Set instances resolve with per-scope values and precedence

- **WHEN** `pipelines.small-feature.gates.propose` is set to `off` globally and `on` in a project's config
- **THEN** effective resolution reports an entry for that instance with both raw scope values and the effective value `on` from the project layer

#### Scenario: Unset instances are absent, not defaulted

- **WHEN** no layer sets any `pipelines.*` instance
- **THEN** effective resolution reports no instance entries for those families (only the family template entries), and no instance reports a default value

#### Scenario: Instance round-trips through each scope's schema

- **WHEN** the test suite runs
- **THEN** a test asserts a set instance of each family round-trips through the configuration schema of every scope the family declares, so the registry and the schemas cannot drift silently

### Requirement: Keepalive keys are registered

The configuration key registry SHALL include the keepalive keys: `keepalive.runtimes.claude` (boolean, default `true`), `keepalive.runtimes.codex` (boolean, default `false`), `keepalive.contextFloor` (number, non-negative integer, default `0` — 0 disables the floor), and `keepalive.beatSeconds` (number, integer between 90 and 280 inclusive, default `270`). `keepalive.runtimes.{claude,codex}` and `keepalive.contextFloor` SHALL be global-only machine-level gates. `keepalive.beatSeconds` SHALL be settable in both `global` and `project` scope — project wins over global via effective-config merge — and SHALL NOT be settable at `store` scope. All keys are validated through the standard registry paths (`config set`/`unset`, the interactive editor, the config HTTP API, effective-config resolution).

#### Scenario: Keepalive runtime gate keys validate
- **WHEN** `rasen config set keepalive.runtimes.codex true --scope global` is run
- **THEN** the registry accepts the key as a boolean and the effective configuration reflects the override

#### Scenario: Context floor validates as a non-negative number
- **WHEN** `rasen config set keepalive.contextFloor abc --scope global` is run
- **THEN** registry validation rejects the value naming the number type, and no file is modified

#### Scenario: Beat seconds accepts the configurable range
- **WHEN** `rasen config set keepalive.beatSeconds 270 --scope global` is run
- **THEN** the registry accepts the value and the effective configuration reflects it

#### Scenario: Beat seconds rejects out-of-range values
- **WHEN** `rasen config set keepalive.beatSeconds 85 --scope global` (or `300`, or a non-integer) is run
- **THEN** registry validation rejects the value naming the 90–280 integer constraint, and no file is modified

#### Scenario: Unset beat seconds resolves to the registry default
- **WHEN** no layer sets `keepalive.beatSeconds` and the effective configuration is resolved
- **THEN** the effective value is `270` with a default source annotation

#### Scenario: Beat seconds is settable at project scope
- **WHEN** `rasen config set keepalive.beatSeconds 150 --scope project` is run
- **THEN** the registry accepts the write (project scope permitted for beatSeconds), and the project value overrides the global value in effective-config resolution

#### Scenario: Beat seconds is rejected at store scope
- **WHEN** `validateConfigKeyPath('keepalive.beatSeconds', 'store')` is called
- **THEN** it returns invalid (store scope not permitted for any keepalive key)

#### Scenario: Runtimes and context floor remain global-only
- **WHEN** `validateConfigKeyPath` is called for `keepalive.runtimes.claude`, `keepalive.runtimes.codex`, and `keepalive.contextFloor` at project scope
- **THEN** each returns invalid (machine-level gates stay global-only)

#### Scenario: Project config schema accepts keepalive.beatSeconds
- **WHEN** `ProjectConfigSchema.safeParse` is given `{ schema: 'spec-driven', keepalive: { beatSeconds: 120 } }`
- **THEN** it parses successfully; an out-of-range beatSeconds (e.g. 300) is rejected

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

