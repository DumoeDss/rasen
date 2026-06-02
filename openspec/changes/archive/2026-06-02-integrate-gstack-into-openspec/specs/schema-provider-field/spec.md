# schema-provider-field Specification

## Purpose
Schema artifact definitions support an optional `provider` field that declares this artifact is provided by a built-in skill rather than manually created. The skill is resolved from the project's `skills/` directory.

## ADDED Requirements

### Requirement: Schema Parsing of Provider Field
Schema parsing SHALL accept an optional `provider` string field on artifact definitions that references a built-in skill name directly.

#### Scenario: Schema with provider field parsed successfully
- **WHEN** a schema YAML contains an artifact with `provider: "review"`
- **THEN** the parsed artifact object includes `provider` with value `"review"`

#### Scenario: Schema without provider field parsed successfully
- **WHEN** a schema YAML contains an artifact without a `provider` field
- **THEN** the parsed artifact object has `provider` as `undefined`

### Requirement: Provider Instruction Output
When `provider` is present, instruction output SHALL include a provider instruction section wrapped in `<provider>` tags, containing the built-in skill name and instructions to invoke it.

#### Scenario: Provider section included in instructions
- **WHEN** instructions are generated for an artifact with `provider: "review"`
- **THEN** the output includes a `<provider>` section containing the skill name `"review"` and instructions to invoke the built-in skill

#### Scenario: No provider section when field is absent
- **WHEN** instructions are generated for an artifact without a `provider` field
- **THEN** the output does not contain a `<provider>` section

### Requirement: Provider Skill Resolution
The provider field value SHALL be resolved as a built-in skill name located in the project's `skills/` directory.

#### Scenario: Provider skill resolved from skills directory
- **WHEN** an artifact has `provider: "review"`
- **THEN** the system resolves the skill from `skills/review/SKILL.md`

#### Scenario: Provider skill resolved with different skill name
- **WHEN** an artifact has `provider: "qa"`
- **THEN** the system resolves the skill from `skills/qa/SKILL.md`

#### Scenario: Provider skill not found
- **WHEN** an artifact has `provider: "nonexistent-skill"` and no matching directory exists in `skills/`
- **THEN** the system reports an error identifying the missing skill

### Requirement: Provider Artifacts in DAG
Provider artifacts SHALL be treated as regular artifacts in the DAG with the same dependency and state tracking.

#### Scenario: Provider artifact has dependencies
- **WHEN** a provider artifact declares `requires: ["specs"]`
- **THEN** the artifact graph treats it as blocked until "specs" is completed

#### Scenario: Provider artifact blocks dependents
- **WHEN** another artifact declares `requires: ["review"]` and "review" is a provider artifact
- **THEN** the dependent artifact is blocked until the provider artifact is completed

### Requirement: State Detection for Provider Artifacts
State detection for provider artifacts SHALL use the same filesystem check as regular artifacts.

#### Scenario: Provider artifact output file exists
- **WHEN** a provider artifact declares `generates: "review-report.md"` and the file exists
- **THEN** the artifact is marked as completed

#### Scenario: Provider artifact output file missing
- **WHEN** a provider artifact declares `generates: "review-report.md"` and the file does not exist
- **THEN** the artifact is not marked as completed

### Requirement: JSON Output Includes Provider Field
The provider field SHALL be included in `openspec instructions --json` output.

#### Scenario: Provider field present in JSON output
- **WHEN** `openspec instructions --json` is run for an artifact with `provider: "review"`
- **THEN** the JSON output includes `"provider": "review"` in the artifact object

#### Scenario: Provider field absent in JSON output when not defined
- **WHEN** `openspec instructions --json` is run for an artifact without a `provider` field
- **THEN** the JSON output does not include a `provider` key for that artifact

### Requirement: Backward-Compatible Schema Validation
Schema validation SHALL accept schemas with and without `provider` fields.

#### Scenario: Schema with provider field passes validation
- **WHEN** a schema is validated that includes `provider` on some artifacts
- **THEN** validation succeeds without errors

#### Scenario: Schema without provider field passes validation
- **WHEN** a schema is validated that has no `provider` fields on any artifact
- **THEN** validation succeeds without errors
