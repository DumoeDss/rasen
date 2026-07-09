## MODIFIED Requirements

### Requirement: Sandboxed Smoke Scenario Runner

The smoke suite SHALL run CLI scenarios in isolated sandboxes so tests are repeatable and do not depend on machine-global state.

#### Scenario: Scenario execution is environment-isolated

- **WHEN** a smoke scenario runs
- **THEN** it SHALL use temporary values for `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `CODEX_HOME`
- **AND** global config from the host machine SHALL NOT affect scenario outcomes

#### Scenario: Scenario artifacts are captured for review

- **WHEN** a smoke scenario completes
- **THEN** the runner SHALL capture command output and exit status
- **AND** SHALL capture enough filesystem state to inspect before/after behavior

#### Scenario: High-risk workflow coverage exists

- **WHEN** the smoke suite executes
- **THEN** it SHALL include scenarios covering profile/delivery behavior and migration-sensitive flows
- **AND** include at least:
  - non-interactive tool detection
  - migration when profile is unset
  - delivery cleanup (`both -> skills`)
  - legacy commands-only install detection and healing (skills restored on update)
