# cli-artifact-workflow Specification (delta)

## ADDED Requirements

### Requirement: Change-scoped workflow payloads carry the work directory

The change-scoped workflow surfaces SHALL expose the change's external work directory (defined by the `change-work-dir` capability): `rasen status --change <n> --json` SHALL include a top-level absolute `workDir` field when the project is registered in the machine home, and both instructions payloads (`rasen instructions <artifact> --change <n> --json` and the apply-instructions payload) SHALL include the same field, establishing project identity on first use per the `change-work-dir` capability. The field SHALL be absent — not empty, not null — when no work directory can be resolved, so older consumers and unregistered projects see payloads shaped exactly as before.

#### Scenario: Status payload includes workDir

- **WHEN** `rasen status --change <n> --json` runs for a registered project
- **THEN** the JSON SHALL include `workDir` as an absolute path alongside `changeRoot`
- **AND** the path SHALL be correct on Windows and POSIX platforms

#### Scenario: Instructions payloads include workDir

- **WHEN** `rasen instructions <artifact> --change <n> --json` or the apply-instructions command runs
- **THEN** the JSON SHALL include the change's `workDir`

#### Scenario: Field omitted when unresolvable

- **WHEN** the project has no machine identity and the surface is read-only (`status`)
- **THEN** the payload SHALL omit `workDir` entirely and remain otherwise unchanged
