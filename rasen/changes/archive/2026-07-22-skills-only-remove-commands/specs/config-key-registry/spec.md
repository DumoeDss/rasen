## MODIFIED Requirements

### Requirement: Declarative registry of settable configuration keys
The system SHALL maintain a single declarative registry of every CLI-settable configuration key, where each entry declares the key path, the scopes it may be set in (`global`, `project`, or both), its value type (boolean, number, string, enum with allowed values, array, or the dual-form `threshold` type), any extra validation constraint, its built-in default, a one-line description, and a display group. Key validation for `config set`/`unset`, the interactive editor, and effective-config resolution SHALL all derive their key knowledge from this registry. The retired `delivery` key SHALL NOT appear in the registry as a settable key.

#### Scenario: Registry drives set validation in both scopes
- **WHEN** a user runs `rasen config set <key> <value>` in either scope
- **THEN** the key is accepted only if the registry lists it for that scope (global scope additionally honors `--allow-unknown` as an escape hatch)
- **AND** the value is validated against the registry's declared type and constraints before any file is written

#### Scenario: Rejection names the constraint
- **WHEN** a user sets `handoff.threshold` to `1.5`
- **THEN** the command fails with a message stating the allowed range or the alternate absolute `{ remainingTokens: N }` form
- **AND** no config file is modified

#### Scenario: The threshold type accepts its dual form
- **WHEN** a user sets `handoff.threshold` to `0.6`, or to `{"remainingTokens": 60000}`
- **THEN** both are accepted — a bare number as the fraction form, the object as the absolute form

#### Scenario: Registered keys cover the promoted options
- **WHEN** the registry is consulted
- **THEN** it includes at least: `profile`, `workflows`, `featureFlags.<name>`, `proactive`, `repoMode`, and `telemetry.enabled` for global scope; `schema`, `archive.timing`, and `archive.destination` for project scope; `autopilot.gates` and `autopilot.selection` for BOTH global and project scope; `handoff.threshold` plus the five per-role thresholds `handoff.roles.planner`, `handoff.roles.implementer`, `handoff.roles.reviewer`, `handoff.roles.fixer`, and `handoff.roles.shipper` for both scopes; and the per-role agent model keys `models.default` plus `models.roles.planner`, `models.roles.implementer`, `models.roles.reviewer`, `models.roles.fixer`, and `models.roles.shipper` for both scopes
- **AND** it SHALL NOT include the retired `delivery` key

#### Scenario: Per-role model keys accept any model id in both scopes
- **WHEN** a user sets `models.roles.reviewer` to `fable`, or `models.default` to `sonnet`, at either global or project scope
- **THEN** the value is accepted as a free-form string (a known preset id and an unrecognized id are both accepted — the registry never rejects a model id by an allow-list)
- **AND** an empty string is rejected with a message that a model id is required

#### Scenario: Autopilot keys are settable at global scope
- **WHEN** a user runs `rasen config set autopilot.gates off --scope global` or `rasen config set autopilot.selection classify --scope global`
- **THEN** the write is accepted and lands in the global config, and the same keys remain settable at project scope

#### Scenario: Per-role handoff thresholds accept the dual form in both scopes
- **WHEN** a user sets `handoff.roles.reviewer` to `0.65`, or to `{"remainingTokens": 40000}`, at either global or project scope
- **THEN** both forms are accepted as a `threshold`-typed value, and an out-of-range or malformed value is rejected with the same message as `handoff.threshold`

#### Scenario: Registry keys stay consistent with the parse schemas
- **WHEN** the test suite runs
- **THEN** a test asserts every registry key — including the promoted-to-both-scopes `autopilot.gates`/`autopilot.selection`, the five per-role `handoff.roles.<role>` keys, and the six `models.default`/`models.roles.<role>` keys — is accepted by the corresponding scope's config schema, so the registry and the zod schemas cannot drift silently
