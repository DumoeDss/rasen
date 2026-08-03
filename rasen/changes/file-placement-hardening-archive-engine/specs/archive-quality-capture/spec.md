## MODIFIED Requirements

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
