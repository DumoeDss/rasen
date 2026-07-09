# archive-quality-capture Specification

## Purpose
During archive, extract quality metrics from quality artifact files and auto-generate quality-rules from review findings.

## ADDED Requirements

### Requirement: Quality Artifact Scanning
archive process SHALL scan the change directory for quality artifact files matching patterns: `*-review.md`, `*-report.md`, `*-audit.md`.

#### Scenario: Quality artifacts found
- **WHEN** the archive process scans a change directory containing `code-review.md` and `security-audit.md`
- **THEN** both files are identified as quality artifacts

#### Scenario: No quality artifacts found
- **WHEN** the archive process scans a change directory with no files matching `*-review.md`, `*-report.md`, or `*-audit.md`
- **THEN** the scan returns an empty list

#### Scenario: Mixed files in change directory
- **WHEN** the change directory contains `proposal.md`, `code-review.md`, and `specs/auth/spec.md`
- **THEN** only `code-review.md` is identified as a quality artifact

### Requirement: Quality Summary Extraction
When quality artifacts exist, archive SHALL extract a quality summary object with fields: total_findings (number), fixed_findings (number), scenarios_tested (number), scenarios_passed (number), security_issues (number).

#### Scenario: Extract quality summary from review file
- **WHEN** a quality artifact contains findings with status markers
- **THEN** the extracted summary includes `total_findings` and `fixed_findings` counts

#### Scenario: Extract scenario metrics from report file
- **WHEN** a quality artifact contains scenario test results
- **THEN** the extracted summary includes `scenarios_tested` and `scenarios_passed` counts

#### Scenario: Extract security issues count
- **WHEN** a quality artifact contains security-related findings
- **THEN** the extracted summary includes `security_issues` count

#### Scenario: Missing metrics default to zero
- **WHEN** a quality artifact does not contain recognizable scenario metrics
- **THEN** the corresponding fields in the summary default to `0`

### Requirement: Quality Summary Written to Archive
The quality summary SHALL be written to the archived change's `.openspec.yaml` under a `quality` key.

#### Scenario: Quality key written to archive metadata
- **WHEN** archive completes with quality artifacts present
- **THEN** the archived `.openspec.yaml` contains a `quality` key with the extracted summary object

#### Scenario: Quality key structure
- **WHEN** archive writes the quality summary
- **THEN** the `quality` object contains keys: `total_findings`, `fixed_findings`, `scenarios_tested`, `scenarios_passed`, `security_issues`

### Requirement: Reusable Pattern Extraction
archive SHALL extract reusable patterns from quality artifacts by looking for lines marked with `[RULE]` prefix.

#### Scenario: Rules extracted from quality artifact
- **WHEN** a quality artifact contains lines `[RULE] Always validate user input` and `[RULE] Use parameterized queries`
- **THEN** two rules are extracted: `"Always validate user input"` and `"Use parameterized queries"`

#### Scenario: No rules markers in quality artifact
- **WHEN** a quality artifact contains no lines with `[RULE]` prefix
- **THEN** zero rules are extracted

#### Scenario: Rule text trimmed of prefix
- **WHEN** a quality artifact contains `[RULE]  Handle edge cases with empty arrays`
- **THEN** the extracted rule is `"Handle edge cases with empty arrays"` (prefix and extra whitespace removed)

### Requirement: Rules Appended to Config
Extracted rules SHALL be appended to `config.yaml`'s `quality-rules` array with no duplicates.

#### Scenario: New rules appended to existing quality-rules
- **WHEN** config contains `quality-rules: ["Existing rule"]` and archive extracts `"New rule"`
- **THEN** config is updated to `quality-rules: ["Existing rule", "New rule"]`

#### Scenario: Duplicate rules not appended
- **WHEN** config contains `quality-rules: ["Validate inputs"]` and archive extracts `"Validate inputs"`
- **THEN** config remains `quality-rules: ["Validate inputs"]` (no duplicate added)

#### Scenario: First rules create the array
- **WHEN** config does not contain a `quality-rules` key and archive extracts `"New rule"`
- **THEN** config is updated to include `quality-rules: ["New rule"]`

### Requirement: Backward-Compatible Archive
When no quality artifacts exist, archive SHALL proceed normally without quality capture.

#### Scenario: Archive without quality artifacts
- **WHEN** the archive process runs on a change with no quality artifact files
- **THEN** archive completes successfully and the archived `.openspec.yaml` does not contain a `quality` key

#### Scenario: Archive with quality artifacts still archives all artifacts
- **WHEN** the archive process runs on a change with both regular and quality artifact files
- **THEN** all artifacts are archived normally in addition to quality capture

### Requirement: Archive Summary Output
archive SHALL display the number of quality rules extracted during the archive summary output.

#### Scenario: Rules count displayed in summary
- **WHEN** archive extracts 3 quality rules
- **THEN** the archive summary output includes a line indicating 3 quality rules were extracted

#### Scenario: Zero rules displayed when none extracted
- **WHEN** archive runs but no `[RULE]` markers are found in quality artifacts
- **THEN** the archive summary output indicates 0 quality rules were extracted

#### Scenario: No quality line when no quality artifacts
- **WHEN** archive runs with no quality artifact files present
- **THEN** the archive summary output does not include a quality rules line
