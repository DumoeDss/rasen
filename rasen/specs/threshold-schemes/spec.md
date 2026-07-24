# threshold-schemes Specification

## Purpose
TBD

## Requirements
### Requirement: Machine-level threshold scheme files

The system SHALL store each threshold scheme as one YAML file under the current user's global Rasen configuration directory in a `schemes` directory. Scheme names SHALL match `^[a-z0-9][a-z0-9._-]{0,63}$`; `default` SHALL be reserved for binding fallback and unavailable as a scheme name. Every valid scheme SHALL contain a `handoff` threshold and a `reuse` threshold, MAY contain `handoffRoles` overrides for the five pipeline roles and `reuseRoles` overrides for `planner` and `implementer`, and SHALL reject unknown fields. Every threshold SHALL accept either a fraction in `(0, 1]` or `{ remainingTokens: <positive integer> }`.

All scheme paths SHALL be constructed with platform path APIs so the same name resolves inside the schemes directory on Windows, macOS, and Linux. Scheme files larger than the supported configuration-file limit, malformed YAML, invalid names, invalid role keys, or invalid threshold values SHALL be reported as invalid schemes rather than partially accepted.

#### Scenario: Valid complete scheme parses

- **WHEN** `focused.yaml` contains `handoff: 0.5`, `handoffRoles.reviewer: 0.6`, `reuse: { remainingTokens: 50000 }`, and `reuseRoles.planner: 0.3`
- **THEN** the scheme is accepted with both scalar thresholds and the declared role overrides

#### Scenario: Both scalar families are required

- **WHEN** a scheme file omits either `handoff` or `reuse`
- **THEN** it is reported as invalid with an actionable validation error

#### Scenario: Invalid roles and unknown fields are rejected

- **WHEN** a scheme declares `reuseRoles.reviewer`, an unknown handoff role, or an unknown top-level property
- **THEN** it is reported as invalid and no partial scheme is returned

#### Scenario: Scheme names cannot escape the machine directory

- **WHEN** a caller supplies `../focused`, `default`, an uppercase name, or a name longer than 64 characters
- **THEN** validation rejects the name before resolving a file path
- **AND** a valid name is resolved with the platform path API under the machine-level schemes directory

### Requirement: Safe scheme library lifecycle

The scheme library SHALL read, list, save, and delete named schemes for programmatic consumers. Listing SHALL be deterministic by name and SHALL keep valid and invalid entries distinct so one malformed file cannot hide the rest of the library. A missing schemes directory SHALL behave as an empty library. Saving SHALL validate the complete scheme before an atomic replacement, and deletion SHALL target only the validated named scheme file.

#### Scenario: Missing directory is an empty library

- **WHEN** the machine-level schemes directory does not exist
- **THEN** listing returns an empty result without creating the directory or failing

#### Scenario: Listing isolates a malformed file

- **WHEN** the directory contains one valid scheme and one malformed `.yaml` file
- **THEN** listing returns both entries in name order, with the valid scheme parsed and the malformed scheme carrying its validation error

#### Scenario: Saving is validated before replacement

- **WHEN** a caller attempts to replace an existing scheme with an invalid threshold object
- **THEN** the save fails before replacement and the prior valid file remains readable

#### Scenario: Cross-platform scheme path round-trip

- **WHEN** a valid scheme is saved, read, and deleted on Windows, macOS, or Linux
- **THEN** every operation targets the same file produced by joining the global config directory, `schemes`, and the validated YAML filename

### Requirement: Headless scheme inspection commands

The CLI SHALL provide non-interactive `rasen scheme list` and `rasen scheme show <name>` commands with `--json` output suitable for scripts. List output SHALL be sorted by scheme name and SHALL identify invalid entries without suppressing valid entries. Show SHALL return the complete parsed scheme when valid and SHALL exit non-zero with an actionable error for an invalid name, a missing scheme, or malformed scheme contents.

#### Scenario: List schemes as JSON

- **WHEN** a user runs `rasen scheme list --json` with valid `balanced.yaml` and `focused.yaml`
- **THEN** the command exits 0 and prints a single JSON result with entries ordered `balanced`, then `focused`

#### Scenario: Empty list needs no terminal

- **WHEN** a script runs `rasen scheme list --json` without a TTY and the schemes directory is absent
- **THEN** the command exits 0 with an empty JSON list

#### Scenario: List reports malformed schemes

- **WHEN** one scheme file is malformed and another is valid
- **THEN** text and JSON list modes identify the invalid entry and still include the valid entry

#### Scenario: Show a valid scheme

- **WHEN** a user runs `rasen scheme show focused --json` for a valid scheme
- **THEN** the command exits 0 and prints its name, handoff settings, and reuse settings as one JSON result

#### Scenario: Show failure is actionable

- **WHEN** a user runs `rasen scheme show` with an invalid name, a missing name, or malformed scheme contents
- **THEN** the command exits non-zero with an error that identifies the name and failure
