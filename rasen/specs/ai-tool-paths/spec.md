# ai-tool-paths Specification

## Purpose
Define AI tool path metadata used to generate Rasen skills and commands in tool-specific directories.
## Requirements
### Requirement: AIToolOption skillsDir field

The `AIToolOption` interface SHALL include an optional `skillsDir` field for skill generation path configuration.

#### Scenario: Interface includes skillsDir field

- **WHEN** a tool entry is defined in `AI_TOOLS` that supports skill generation
- **THEN** it SHALL include a `skillsDir` field specifying the project-local base directory (e.g., `.claude`)

#### Scenario: Skills path follows Agent Skills spec

- **WHEN** generating skills for a tool with `skillsDir: '.claude'`
- **THEN** skills SHALL be written to `<projectRoot>/<skillsDir>/skills/`
- **AND** the `/skills` suffix is appended per Agent Skills specification

### Requirement: Path configuration for supported tools

The `AI_TOOLS` array SHALL include `skillsDir` for tools that support the Agent Skills specification.

#### Scenario: Claude Code paths defined

- **WHEN** looking up the `claude` tool
- **THEN** `skillsDir` SHALL be `.claude`

#### Scenario: Cursor paths defined

- **WHEN** looking up the `cursor` tool
- **THEN** `skillsDir` SHALL be `.cursor`

#### Scenario: Windsurf paths defined

- **WHEN** looking up the `windsurf` tool
- **THEN** `skillsDir` SHALL be `.windsurf`

#### Scenario: Kimi CLI paths defined

- **WHEN** looking up the `kimi` tool
- **THEN** `skillsDir` SHALL be `.kimi`

#### Scenario: Tools without skillsDir

- **WHEN** a tool has no `skillsDir` defined
- **THEN** skill generation SHALL error with message indicating the tool is not supported

### Requirement: Cross-platform path handling

The system SHALL handle paths correctly across operating systems.

#### Scenario: Path construction on Windows

- **WHEN** constructing skill paths on Windows
- **THEN** the system SHALL use `path.join()` for all path construction
- **AND** SHALL NOT hardcode forward slashes

#### Scenario: Path construction on Unix

- **WHEN** constructing skill paths on macOS or Linux
- **THEN** the system SHALL use `path.join()` for consistency

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
