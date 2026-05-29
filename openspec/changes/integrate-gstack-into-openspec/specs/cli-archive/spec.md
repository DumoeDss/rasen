# Delta Spec: cli-archive

**Change:** integrate-gstack-into-openspec
**Modifies:** openspec/specs/cli-archive/spec.md

## ADDED Requirements

### Requirement: Quality Artifact Scanning
The archive command SHALL scan the change directory for quality artifact files before archiving.

#### Scenario: Quality artifacts found
- **WHEN** change directory contains files matching `*-review.md`, `*-report.md`, or `*-audit.md`
- **THEN** archive extracts quality metrics from these files

#### Scenario: No quality artifacts
- **WHEN** change directory contains no quality artifact files
- **THEN** archive proceeds normally without quality capture

### Requirement: Quality Summary in Archive Metadata
The archive command SHALL write a quality summary to the archived change's `.openspec.yaml` file.

#### Scenario: Writing quality summary
- **WHEN** quality artifacts are found and metrics extracted
- **THEN** `.openspec.yaml` in the archived directory includes a `quality` key with extracted metrics

#### Scenario: Display quality summary
- **WHEN** archive completes with quality data captured
- **THEN** archive summary output includes the number of findings and test results

### Requirement: Quality Rules Auto-Generation
The archive command SHALL extract reusable rules from quality artifacts and append them to project config.

#### Scenario: Rules extracted from review
- **WHEN** quality artifact contains lines prefixed with `[RULE]`
- **THEN** the text after `[RULE]` is appended to `config.yaml`'s `quality-rules` array

#### Scenario: Duplicate rule prevention
- **WHEN** an extracted rule already exists in `quality-rules`
- **THEN** the duplicate is not added

#### Scenario: Display extracted rules count
- **WHEN** archive completes with rules extracted
- **THEN** archive summary output shows "Extracted N quality rules"
