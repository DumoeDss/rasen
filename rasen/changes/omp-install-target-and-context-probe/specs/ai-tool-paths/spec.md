## ADDED Requirements

### Requirement: Oh My Pi paths defined

The `AI_TOOLS` array SHALL include an `omp` entry marked `adapted: true` with a `skillsDir` of `.omp`, so it passes the adapted-selection filter, is offered for installation, and resolves to the project-local skills root Oh My Pi's own highest-priority discovery provider reads. The entry SHALL declare detection paths naming real Oh My Pi configuration content, so an empty `.omp/` directory is not read as a configured tool.

#### Scenario: Oh My Pi entry present and adapted

- **WHEN** looking up the `omp` tool
- **THEN** an entry SHALL exist with `value: 'omp'`
- **AND** it SHALL have `adapted: true`
- **AND** it SHALL have `skillsDir: '.omp'`

#### Scenario: Oh My Pi resolves to the project skills directory

- **WHEN** resolving the skills root for `omp`
- **THEN** the skills root SHALL be `<projectRoot>/.omp/skills/`
- **AND** SHALL NOT resolve to any machine-global skills home

#### Scenario: Oh My Pi detection names content rather than the directory

- **WHEN** the `omp` entry's detection metadata is read
- **THEN** it SHALL enumerate specific Oh My Pi configuration paths inside `.omp/`
- **AND** the bare `.omp/` directory alone SHALL NOT satisfy detection

## MODIFIED Requirements

### Requirement: Adapted designation on the tool registry

The `AIToolOption` interface SHALL include an optional `adapted` field indicating whether Rasen has adapted its orchestration for that agent. The `AI_TOOLS` array SHALL mark with `adapted: true` exactly the agents Rasen has adapted, and no others; the shipped set SHALL be the single source of truth for which agents those are rather than a count restated in this requirement. Entries for all other agents SHALL be left unchanged (no `adapted` field, treated as not adapted).

#### Scenario: Adapted field present on the interface

- **WHEN** a tool entry is defined in `AI_TOOLS`
- **THEN** the `AIToolOption` shape SHALL permit an optional `adapted` boolean field
- **AND** the absence of the field SHALL be equivalent to `adapted: false`

#### Scenario: Only adapted agents are flagged

- **WHEN** looking up a tool that Rasen's orchestration is adapted for
- **THEN** its entry SHALL have `adapted: true`

#### Scenario: Unadapted agents are unflagged and otherwise unchanged

- **WHEN** looking up a tool that Rasen's orchestration is not adapted for
- **THEN** its entry SHALL NOT have `adapted: true`
- **AND** its `skillsDir`, `detectionPaths`, and other fields SHALL remain exactly as previously defined

### Requirement: Per-tool skills root resolution

The location a tool's Rasen skills are written to SHALL be resolved per tool. For tools that keep skills in the project — including Claude Code, Codex, and Oh My Pi — the skills root SHALL be `<projectRoot>/<skillsDir>/skills/`. For a tool whose skills live in a global home (Hermes), the skills root SHALL resolve to that global home's skills directory (`<HERMES_HOME or ~/.hermes>/skills/`). The default resolution for every existing tool SHALL be unchanged.

#### Scenario: Project-local tool resolves to the project skills directory

- **WHEN** resolving the skills root for a tool without a global skills home (e.g. `claude` or `omp`)
- **THEN** the skills root SHALL be `<projectRoot>/<skillsDir>/skills/`

#### Scenario: Hermes resolves to its global skills home

- **WHEN** resolving the skills root for `hermes`
- **THEN** the skills root SHALL be `<HERMES_HOME or ~/.hermes>/skills/`
- **AND** SHALL NOT depend on the project path

#### Scenario: Cross-platform resolution

- **WHEN** resolving any tool's skills root
- **THEN** the path SHALL be constructed with platform-safe path joining (never hardcoded separators)
