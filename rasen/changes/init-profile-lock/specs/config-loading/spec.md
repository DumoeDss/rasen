# config-loading Delta

## ADDED Requirements

### Requirement: Project config carries an optional profile field

The project config (`rasen/config.yaml` or `config.yml`) SHALL support an optional `profile` string field naming the project's locked profile (`full`, `core`, or a saved profile name). Parsing SHALL follow the config's existing resilient field-by-field policy: a non-empty string value is exposed on the parsed config; a non-string or empty value is dropped with a warning naming the field; the field's absence is not an error. At parse time the value is an opaque name — whether it resolves to an available profile is decided where the selection is resolved (see the profiles spec), not during config loading.

#### Scenario: Valid profile is exposed

- **WHEN** the config contains `profile: team-web`
- **THEN** the parsed project config includes `profile` = `team-web`

#### Scenario: Non-string profile is dropped resiliently

- **WHEN** the config contains `profile: [not, a, string]`
- **THEN** a warning identifies the invalid `profile` field
- **AND** the rest of the config still parses and is returned

#### Scenario: Empty profile is dropped resiliently

- **WHEN** the config contains `profile: ""`
- **THEN** a warning identifies the invalid `profile` field
- **AND** the rest of the config still parses and is returned

#### Scenario: Absent profile is not an error

- **WHEN** the config has no `profile` field
- **THEN** the config parses without warnings about `profile`

#### Scenario: Unknown profile name still parses

- **WHEN** the config contains `profile: no-such-profile` and no saved definition with that name exists on this machine
- **THEN** config loading exposes the value without error (resolution-time behavior is defined in the profiles spec)
