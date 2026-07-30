## MODIFIED Requirements

### Requirement: Archive block carries an optional destination field

The project config's `archive` map SHALL continue to accept an optional `destination` field for compatibility, parsed under the existing resilient field-by-field policy — but the field is DEPRECATED and non-behavioral: a valid value (`in-repo`, `external`, `prune`) is exposed on the parsed config solely so legacy-archive discovery and migration tooling can see it, and parsing a non-default value (`external` or `prune`) SHALL emit a deprecation warning naming `archive.destination` and stating that archives always land in the planning root. An invalid value is dropped with the existing invalid-field warning while the rest of the config — including other `archive` fields such as `timing` — still parses; absence is not an error and produces no warning. The deprecation warning SHALL be localized like other config warnings.

#### Scenario: Valid destination is exposed

- **WHEN** the config contains an `archive` block with `destination: external`
- **THEN** the parsed project config includes `archive.destination` = `external`
- **AND** a deprecation warning names `archive.destination` and states that archive bookkeeping always lands in the planning root

#### Scenario: Invalid destination dropped resiliently

- **WHEN** the config contains an `archive` block with `destination: elsewhere` and `timing: in-ship`
- **THEN** a warning identifies the invalid `archive.destination` field
- **AND** `archive.timing` = `in-ship` and the rest of the config still parse

#### Scenario: Absent destination is not an error

- **WHEN** the config's `archive` block has no `destination` field
- **THEN** the config parses without warnings about `destination`
