# config-loading Specification (delta)

## ADDED Requirements

### Requirement: Archive block carries an optional destination field

The project config's `archive` map SHALL support an optional `destination` field whose valid values are `in-repo`, `external`, and `prune`, parsed under the existing resilient field-by-field policy: a valid value is exposed on the parsed config; an invalid value is dropped with a warning naming `archive.destination` while the rest of the config — including other `archive` fields such as `timing` — still parses; absence is not an error. Parsers that predate this field SHALL be unaffected by its presence (unknown keys in the `archive` map are ignored).

#### Scenario: Valid destination is exposed

- **WHEN** the config contains an `archive` block with `destination: external`
- **THEN** the parsed project config includes `archive.destination` = `external`

#### Scenario: Invalid destination dropped resiliently

- **WHEN** the config contains an `archive` block with `destination: elsewhere` and `timing: in-ship`
- **THEN** a warning identifies the invalid `archive.destination` field
- **AND** `archive.timing` = `in-ship` and the rest of the config still parse

#### Scenario: Absent destination is not an error

- **WHEN** the config's `archive` block has no `destination` field
- **THEN** the config parses without warnings about `destination`
