# archive-quality-capture Specification

## Purpose
When archiving a change, the archive process captures quality signals from the change's review/report/audit artifacts — scanning for them, extracting a quality summary, and recording it on the archived change — so quality outcomes are preserved alongside the archived spec.

## Requirements
### Requirement: Quality Artifact Scanning

The archive engine SHALL scan the finalized canonical `<changeRoot>/evidence/` tree recursively for quality artifact filenames covered by the product's explicit quality-report lookup/pattern contract. Results SHALL be stable relative paths ordered deterministically. The scanner SHALL not follow symlinks outside evidence, and only an `ENOENT` evidence directory SHALL mean no quality artifacts; permission, I/O, containment, and file-read failures SHALL block final accounting.

#### Scenario: Quality artifacts found recursively

- **WHEN** finalized evidence contains `evidence/review-report.md` and `evidence/security/cso-report.md`
- **THEN** both relative paths SHALL be identified as quality artifacts
- **AND** both SHALL be present in archive quality metadata and the hashed evidence inventory

#### Scenario: No quality artifacts found

- **WHEN** the evidence directory exists and contains no covered quality report filenames
- **THEN** the scan SHALL return a complete empty quality list

#### Scenario: Mixed files in evidence

- **WHEN** evidence contains `surface-matrix.md`, `review-report.md`, and `drivers/verify.sh`
- **THEN** only `review-report.md` SHALL be identified as a quality artifact
- **AND** all files SHALL remain eligible for the separate evidence hash inventory

#### Scenario: Unreadable nested report blocks capture

- **WHEN** a nested quality report fails to inspect or read with `EACCES`, `EPERM`, or `EIO`
- **THEN** archive SHALL report the failed operation and relative path
- **AND** SHALL NOT publish a successful quality summary or partial accounting

#### Scenario: Windows and POSIX paths identify the same reports

- **WHEN** equivalent evidence trees are scanned on Windows, macOS, and Linux
- **THEN** platform-native containment and separators SHALL identify the same semantic report set
- **AND** recorded archive-relative paths SHALL be deterministic

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

The quality summary SHALL be written to the staged archive's `.openspec.yaml` before evidence inventory and hashing. It SHALL record the stable archive-relative path of each recursively discovered quality file and its extracted metrics. A successful archive SHALL not modify this metadata or any covered evidence after `archive.json` is finalized.

#### Scenario: Quality key written before accounting

- **WHEN** archive captures top-level or nested quality artifacts
- **THEN** staged `.openspec.yaml` SHALL contain a `quality` key with every discovered relative path and extracted metrics
- **AND** capture SHALL complete before `archive.json` evidence hashes are finalized

#### Scenario: Quality key structure records path identity

- **WHEN** two nested directories contain quality reports with the same basename
- **THEN** the `quality` object SHALL distinguish them by their archive-relative paths
- **AND** neither result SHALL overwrite the other

#### Scenario: Quality metadata remains final

- **WHEN** archive reports success
- **THEN** `.openspec.yaml` quality metadata and its referenced evidence files SHALL remain unchanged by later single, bulk, or ship workflow steps

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
