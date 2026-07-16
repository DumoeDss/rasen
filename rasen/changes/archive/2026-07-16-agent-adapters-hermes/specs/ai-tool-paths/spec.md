## ADDED Requirements

### Requirement: Hermes paths defined

The `AI_TOOLS` array SHALL include a `hermes` entry marked `adapted: true` with a `skillsDir` so it passes the adapted-selection filter and is offered for installation.

#### Scenario: Hermes entry present and adapted

- **WHEN** looking up the `hermes` tool
- **THEN** an entry SHALL exist with `value: 'hermes'`
- **AND** it SHALL have `adapted: true`
- **AND** it SHALL have a `skillsDir` defined

### Requirement: Per-tool skills root resolution

The location a tool's Rasen skills are written to SHALL be resolved per tool. For tools that keep skills in the project, the skills root SHALL be `<projectRoot>/<skillsDir>/skills/`. For a tool whose skills live in a global home (Hermes), the skills root SHALL resolve to that global home's skills directory (`<HERMES_HOME or ~/.hermes>/skills/`). The default resolution for every existing tool SHALL be unchanged.

#### Scenario: Project-local tool resolves to the project skills directory

- **WHEN** resolving the skills root for a tool without a global skills home (e.g. `claude`)
- **THEN** the skills root SHALL be `<projectRoot>/<skillsDir>/skills/`

#### Scenario: Hermes resolves to its global skills home

- **WHEN** resolving the skills root for `hermes`
- **THEN** the skills root SHALL be `<HERMES_HOME or ~/.hermes>/skills/`
- **AND** SHALL NOT depend on the project path

#### Scenario: Cross-platform resolution

- **WHEN** resolving any tool's skills root
- **THEN** the path SHALL be constructed with platform-safe path joining (never hardcoded separators)
