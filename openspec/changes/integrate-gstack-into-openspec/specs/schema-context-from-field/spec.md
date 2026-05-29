# schema-context-from-field Specification

## Purpose
Schema artifact definitions support an optional `context-from` field that declares which completed artifact's content should be parsed and injected as structured context.

## ADDED Requirements

### Requirement: Schema Parsing of Context-From Field
Schema parsing SHALL accept an optional `context-from` string field on artifact definitions that references another artifact ID.

#### Scenario: Schema with context-from field parsed successfully
- **WHEN** a schema YAML contains an artifact with `context-from: "specs"`
- **THEN** the parsed artifact object includes `context-from` with value `"specs"`

#### Scenario: Schema without context-from field parsed successfully
- **WHEN** a schema YAML contains an artifact without a `context-from` field
- **THEN** the parsed artifact object has `context-from` as `undefined`

### Requirement: Context-From Reference Validation
Schema validation SHALL verify that `context-from` references a valid artifact ID in the same schema.

#### Scenario: Valid context-from reference
- **WHEN** a schema contains artifact "review" with `context-from: "specs"` and artifact "specs" exists in the same schema
- **THEN** validation succeeds without errors

#### Scenario: Invalid context-from reference
- **WHEN** a schema contains artifact "review" with `context-from: "nonexistent"` and no artifact "nonexistent" exists
- **THEN** validation fails with an error identifying the invalid reference

### Requirement: Context-From Requires Explicit Dependency
The referenced artifact MUST be in the `requires` list of the artifact declaring `context-from`.

#### Scenario: Context-from target is in requires list
- **WHEN** artifact "review" has `context-from: "specs"` and `requires: ["specs"]`
- **THEN** validation succeeds without errors

#### Scenario: Context-from target is not in requires list
- **WHEN** artifact "review" has `context-from: "specs"` but "specs" is not in its `requires` list
- **THEN** validation fails with an error indicating that the `context-from` target must be an explicit dependency

### Requirement: Structured Context Injection When Reference Is Done
When `context-from` is present and the referenced artifact is done, instruction-loader SHALL parse the referenced artifact's content and inject structured context wrapped in `<structured-context>` tags.

#### Scenario: Referenced artifact is done
- **WHEN** instructions are generated for an artifact with `context-from: "specs"` and the "specs" artifact is completed
- **THEN** the output includes a `<structured-context>` section containing parsed content from the "specs" artifact's output file

#### Scenario: Referenced artifact is not done
- **WHEN** instructions are generated for an artifact with `context-from: "specs"` and the "specs" artifact is not completed
- **THEN** the output does not contain a `<structured-context>` section

### Requirement: JSON Output Includes Context-From Field
The context-from field SHALL be included in `openspec instructions --json` output.

#### Scenario: Context-from field present in JSON output
- **WHEN** `openspec instructions --json` is run for an artifact with `context-from: "specs"`
- **THEN** the JSON output includes `"context-from": "specs"` in the artifact object

#### Scenario: Context-from field absent in JSON output when not defined
- **WHEN** `openspec instructions --json` is run for an artifact without a `context-from` field
- **THEN** the JSON output does not include a `context-from` key for that artifact
