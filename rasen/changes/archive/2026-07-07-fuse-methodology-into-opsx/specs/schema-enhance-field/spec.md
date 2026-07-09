## MODIFIED Requirements

### Requirement: Schema Parsing of Enhance Field
Schema parsing SHALL accept an optional `enhance` string field on artifact definitions that references a built-in skill name.

#### Scenario: Schema with enhance field parsed successfully
- **WHEN** a schema YAML contains an artifact with `enhance: "review"`
- **THEN** the parsed artifact object includes `enhance` with value `"review"`

#### Scenario: Schema without enhance field parsed successfully
- **WHEN** a schema YAML contains an artifact without an `enhance` field
- **THEN** the parsed artifact object has `enhance` as `undefined`

### Requirement: Enhance Instruction Output
When `enhance` is present, instruction output SHALL include an enhance instruction section wrapped in `<enhance>` tags, containing the built-in skill name and guidance to invoke it after creating the artifact.

#### Scenario: Enhance section included in instructions
- **WHEN** instructions are generated for an artifact with `enhance: "review"`
- **THEN** the output includes an `<enhance>` section containing the skill name `"review"` and guidance to invoke the built-in skill after artifact creation

#### Scenario: No enhance section when field is absent
- **WHEN** instructions are generated for an artifact without an `enhance` field
- **THEN** the output does not contain an `<enhance>` section

### Requirement: Enhance Skill Resolution
The enhance field value SHALL be resolved as a built-in skill name located in the project's `skills/` directory.

#### Scenario: Enhance skill resolved from skills directory
- **WHEN** an artifact has `enhance: "review"`
- **THEN** the system resolves the skill from `skills/review/SKILL.md`

#### Scenario: Enhance skill not found
- **WHEN** an artifact has `enhance: "nonexistent-skill"` and no matching directory exists in `skills/`
- **THEN** the system reports an error identifying the missing skill

### Requirement: JSON Output Includes Enhance Field
The enhance field SHALL be included in `openspec instructions --json` output.

#### Scenario: Enhance field present in JSON output
- **WHEN** `openspec instructions --json` is run for an artifact with `enhance: "review"`
- **THEN** the JSON output includes `"enhance": "review"` in the artifact object

#### Scenario: Enhance field absent in JSON output when not defined
- **WHEN** `openspec instructions --json` is run for an artifact without an `enhance` field
- **THEN** the JSON output does not include an `enhance` key for that artifact
