# config-loading Specification

## Purpose
Define how `rasen/config.yaml` is discovered, parsed, validated, and exposed to callers with safe fallbacks.
## Requirements
### Requirement: Load project config from rasen/config.yaml

The system SHALL read and parse the project configuration file located at `rasen/config.yaml` relative to the project root.

#### Scenario: Valid config file exists
- **WHEN** `rasen/config.yaml` exists with valid YAML content
- **THEN** system parses the file and returns a ProjectConfig object

#### Scenario: Config file does not exist
- **WHEN** `rasen/config.yaml` does not exist
- **THEN** system returns null without error

#### Scenario: Config file has invalid YAML syntax
- **WHEN** `rasen/config.yaml` contains malformed YAML
- **THEN** system logs a warning message and returns null

#### Scenario: Config file has valid YAML but invalid schema
- **WHEN** `rasen/config.yaml` contains valid YAML that fails Zod schema validation
- **THEN** system logs a warning message with validation details and returns null

### Requirement: Support .yml file extension alias

The system SHALL accept both `.yaml` and `.yml` file extensions for the config file.

#### Scenario: Config file uses .yml extension
- **WHEN** `rasen/config.yml` exists and `rasen/config.yaml` does not exist
- **THEN** system reads from `rasen/config.yml`

#### Scenario: Both .yaml and .yml exist
- **WHEN** both `rasen/config.yaml` and `rasen/config.yml` exist
- **THEN** system prefers `rasen/config.yaml`

### Requirement: Use resilient field-by-field parsing
The system SHALL parse each config field independently, collecting valid fields and warning about invalid ones without rejecting the entire config. This includes the `quality-rules` field.

#### Scenario: Schema field is valid
- **WHEN** config contains `schema: "spec-driven"`
- **THEN** schema field is included in returned config

#### Scenario: Schema field is missing
- **WHEN** config lacks the `schema` field
- **THEN** no warning is logged (field is optional at parse level)

#### Scenario: Schema field is empty string
- **WHEN** config contains `schema: ""`
- **THEN** warning is logged and schema field is not included in returned config

#### Scenario: Schema field is invalid type
- **WHEN** config contains `schema: 123` (number instead of string)
- **THEN** warning is logged and schema field is not included in returned config

#### Scenario: Context field is valid
- **WHEN** config contains `context: "Tech stack: TypeScript"`
- **THEN** context field is included in returned config

#### Scenario: Context field is invalid type
- **WHEN** config contains `context: 123` (number instead of string)
- **THEN** warning is logged and context field is not included in returned config

#### Scenario: Rules field has valid structure
- **WHEN** config contains `rules: { proposal: ["Rule 1"], specs: ["Rule 2"] }`
- **THEN** rules field is included in returned config with valid rules

#### Scenario: Rules field has non-array value for artifact
- **WHEN** config contains `rules: { proposal: "not an array", specs: ["Valid"] }`
- **THEN** warning is logged for proposal, but specs rules are still included in returned config

#### Scenario: Rules array contains non-string elements
- **WHEN** config contains `rules: { proposal: ["Valid rule", 123, ""] }`
- **THEN** only "Valid rule" is included, warning logged about invalid elements

#### Scenario: Mix of valid and invalid fields
- **WHEN** config contains valid schema, invalid context type, valid rules
- **THEN** config is returned with schema and rules fields, warning logged about context

#### Scenario: Quality-rules field is valid string array
- **WHEN** config contains `quality-rules: ["Avoid N+1 queries", "Check auth tokens"]`
- **THEN** quality-rules field is included in returned config

#### Scenario: Quality-rules field is invalid type
- **WHEN** config contains `quality-rules: "not an array"`
- **THEN** warning is logged and quality-rules field is not included in returned config

#### Scenario: Quality-rules array contains non-string elements
- **WHEN** config contains `quality-rules: ["Valid rule", 123]`
- **THEN** only "Valid rule" is included, warning logged about invalid elements

#### Scenario: Quality-rules field is missing
- **WHEN** config lacks the `quality-rules` field
- **THEN** no warning is logged (field is optional)

### Requirement: Enforce context size limit

The system SHALL reject context fields exceeding 50KB and log a warning.

#### Scenario: Context within size limit
- **WHEN** config contains context of 1KB
- **THEN** context is included in returned config

#### Scenario: Context at size limit
- **WHEN** config contains context of exactly 50KB
- **THEN** context is included in returned config

#### Scenario: Context exceeds size limit
- **WHEN** config contains context of 51KB
- **THEN** warning is logged with size and limit, context field is not included in returned config

### Requirement: Defer artifact ID validation to instruction loading

The system SHALL NOT validate artifact IDs in rules during config load time. Validation happens during instruction loading when schema is known.

#### Scenario: Config with rules is loaded
- **WHEN** config contains `rules: { unknownartifact: [...] }`
- **THEN** config is loaded successfully without validation errors

#### Scenario: Validation happens at instruction load time
- **WHEN** instructions are loaded for any artifact and config has unknown artifact IDs in rules
- **THEN** warnings are emitted about unknown artifact IDs (see rules-injection spec for details)

### Requirement: Gracefully handle config errors without halting

The system SHALL continue operation with default values when config loading or parsing fails.

#### Scenario: Config parse failure during command execution
- **WHEN** config file has syntax errors and user runs `rasen new change`
- **THEN** command executes using default schema "spec-driven"

#### Scenario: Warning is visible to user
- **WHEN** config loading fails
- **THEN** system outputs warning message to stderr with details about the failure

### Requirement: Project config carries an optional projectId

The project config (`rasen/config.yaml` or `config.yml`) SHALL support an optional `projectId` string field identifying the project to machine-local features such as the project registry. Parsing SHALL follow the config's existing resilient policy: a valid string value is exposed on the parsed config; a non-string value is dropped with a warning naming the field; the field's absence is not an error. Any string value SHALL be accepted as an opaque identifier.

#### Scenario: Valid projectId is exposed

- **WHEN** the config contains `projectId: 6f9c1e2a-3b44-4b7e-9d15-2f8a1c0e5d21`
- **THEN** the parsed project config includes that `projectId` value unchanged

#### Scenario: Invalid projectId is dropped resiliently

- **WHEN** the config contains `projectId: [not, a, string]`
- **THEN** a warning identifies the invalid `projectId` field
- **AND** the rest of the config still parses and is returned

#### Scenario: Absent projectId is not an error

- **WHEN** the config has no `projectId` field
- **THEN** the config parses without warnings about `projectId`

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

