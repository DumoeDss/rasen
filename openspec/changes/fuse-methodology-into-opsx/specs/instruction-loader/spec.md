## MODIFIED Requirements

### Requirement: Template Enrichment
The system SHALL enrich templates with change-specific context, quality rules, and extended field instructions.

#### Scenario: Include artifact metadata
- **WHEN** instructions are generated for an artifact
- **THEN** the output includes change name, artifact ID, schema name, and output path

#### Scenario: Include dependency status
- **WHEN** an artifact has dependencies
- **THEN** the output shows each dependency with completion status (done/missing)

#### Scenario: Include unlocked artifacts
- **WHEN** instructions are generated
- **THEN** the output includes which artifacts become available after this one

#### Scenario: Root artifact indicator
- **WHEN** an artifact has no dependencies
- **THEN** the dependency section indicates this is a root artifact

#### Scenario: Include quality-rules section
- **WHEN** project config contains non-empty `quality-rules` array
- **THEN** instruction output includes `<quality-rules>` section after `<rules>` and before `<template>`, with each rule as a bullet point

#### Scenario: Omit quality-rules when empty
- **WHEN** project config has no `quality-rules` or the array is empty
- **THEN** instruction output does not include `<quality-rules>` tags

#### Scenario: Include enhance instruction
- **WHEN** artifact has `enhance` field set to "review"
- **THEN** instruction output includes `<enhance>` section with the built-in skill name and path to `skills/review/SKILL.md`

#### Scenario: Include provider instruction
- **WHEN** artifact has `provider` field set to "review"
- **THEN** instruction output includes `<provider>` section with the built-in skill name and path to `skills/review/SKILL.md`

#### Scenario: Include structured context from context-from
- **WHEN** artifact has `context-from: "specs"` and specs artifact is done
- **THEN** instruction output includes `<structured-context>` section with parsed content from the referenced artifact
