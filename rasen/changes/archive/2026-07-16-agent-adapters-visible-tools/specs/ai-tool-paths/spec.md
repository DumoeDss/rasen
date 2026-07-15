## ADDED Requirements

### Requirement: Adapted designation on the tool registry

The `AIToolOption` interface SHALL include an optional `adapted` field indicating whether Rasen has adapted its orchestration for that agent. The `AI_TOOLS` array SHALL mark only the agents Rasen has adapted with `adapted: true`; at the time of this change those are `claude` and `codex`. Entries for all other agents SHALL be left unchanged (no `adapted` field, treated as not adapted).

#### Scenario: Adapted field present on the interface

- **WHEN** a tool entry is defined in `AI_TOOLS`
- **THEN** the `AIToolOption` shape SHALL permit an optional `adapted` boolean field
- **AND** the absence of the field SHALL be equivalent to `adapted: false`

#### Scenario: Only adapted agents are flagged

- **WHEN** looking up the `claude` or `codex` tool
- **THEN** its entry SHALL have `adapted: true`

#### Scenario: Unadapted agents are unflagged and otherwise unchanged

- **WHEN** looking up any tool other than `claude` or `codex`
- **THEN** its entry SHALL NOT have `adapted: true`
- **AND** its `skillsDir`, `detectionPaths`, and other fields SHALL remain exactly as previously defined
