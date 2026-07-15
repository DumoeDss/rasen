## MODIFIED Requirements

### Requirement: Only adapted agents are offered for installation

Rasen SHALL offer an AI coding agent for installation only when Rasen has adapted its orchestration for that agent. An agent is "adapted" when Rasen's dispatch, worker lifecycle, and resume behavior are implemented for it. At the time of this capability, the adapted agents SHALL be Claude Code (`claude`), Codex (`codex`), and Hermes (`hermes`). All other known agents SHALL be hidden from every install/selection surface while remaining defined in the tool registry.

#### Scenario: Install surface lists only adapted agents

- **WHEN** the set of installable tools is computed for any selection surface (interactive multi-select, `--tools all` expansion, or `--tools` help text)
- **THEN** the result SHALL contain only adapted agents (`claude`, `codex`, and `hermes`)
- **AND** SHALL NOT contain any unadapted agent

#### Scenario: Hidden agents remain defined but not offered

- **WHEN** an agent is defined in the tool registry but is not adapted
- **THEN** the agent's registry entry, paths, and detection metadata SHALL remain present and unchanged
- **AND** the agent SHALL NOT appear as an installable choice

### Requirement: Explicitly requesting an unadapted agent is refused with a distinguishing message

When a user explicitly names a known-but-unadapted agent as a tool to install, Rasen SHALL refuse and SHALL explain that the agent is recognized but not yet adapted — distinct from the error shown for an unrecognized token. An agent that IS adapted (including Hermes) SHALL be accepted rather than refused.

#### Scenario: Known unadapted agent requested explicitly

- **WHEN** a user requests installation of a tool that exists in the registry, has a skills directory, but is not adapted (e.g. `cursor`)
- **THEN** the system SHALL fail with exit code 1
- **AND** SHALL display a message stating the tool is recognized but not yet adapted in Rasen
- **AND** SHALL name the currently adapted tools (`claude`, `codex`, `hermes`)

#### Scenario: Adapted agent requested explicitly is accepted

- **WHEN** a user requests installation of an adapted tool (`claude`, `codex`, or `hermes`)
- **THEN** the system SHALL proceed with setup for that tool
- **AND** SHALL NOT display the "not yet adapted" message

#### Scenario: Unrecognized token requested explicitly

- **WHEN** a user requests installation of a token that does not correspond to any registry entry (e.g. `not-a-tool`)
- **THEN** the system SHALL fail with exit code 1
- **AND** SHALL display the existing invalid/unknown-tool error rather than the "not yet adapted" message
