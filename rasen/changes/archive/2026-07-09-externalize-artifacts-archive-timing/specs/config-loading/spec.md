# config-loading Specification (delta)

## ADDED Requirements

### Requirement: Project config carries an optional archive block

The project config (`rasen/config.yaml` or `config.yml`) SHALL support an optional `archive` map with an optional `timing` field whose valid values are `on-merge` and `in-ship`. Parsing SHALL follow the config's existing resilient field-by-field policy: a valid block is exposed on the parsed config; a non-map `archive` value is dropped with a warning naming the field; an invalid `timing` value is dropped with a warning while the rest of the config (and the rest of the `archive` block, when future fields exist) still parses; absence of the block or field is not an error. The block is extensible — future archive-related fields (e.g. a destination) join the same map.

#### Scenario: Valid archive timing is exposed

- **WHEN** the config contains an `archive` block with `timing: in-ship`
- **THEN** the parsed project config includes `archive.timing` = `in-ship`

#### Scenario: Invalid timing dropped resiliently

- **WHEN** the config contains an `archive` block with `timing: 42`
- **THEN** a warning identifies the invalid `archive.timing` field
- **AND** the rest of the config still parses and is returned

#### Scenario: Non-map archive value dropped resiliently

- **WHEN** the config contains `archive: banana`
- **THEN** a warning identifies the invalid `archive` field
- **AND** the rest of the config still parses and is returned

#### Scenario: Absent archive block is not an error

- **WHEN** the config has no `archive` block
- **THEN** the config parses without warnings about `archive`
