## MODIFIED Requirements

### Requirement: Update detects new tool directories
The update command SHALL notify the user if new **adapted** AI tool directories are detected that aren't currently configured. It SHALL NOT nudge the user to add an unadapted tool, since the installer will refuse it.

#### Scenario: New adapted tool directory detected
- **WHEN** user runs `rasen update`
- **AND** a new adapted tool directory is detected (e.g., `.codex/` exists but Codex is not configured)
- **THEN** the system SHALL display: "Detected new tool: Codex. Run 'rasen init' to add it."
- **THEN** the system SHALL NOT automatically add the new tool
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: New unadapted tool directory is not nudged
- **WHEN** user runs `rasen update`
- **AND** a new tool directory for an unadapted tool is detected (e.g., `.windsurf/` exists but Windsurf is not configured)
- **THEN** the system SHALL NOT display a "Detected new tool" message for that tool
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: Multiple new adapted tool directories detected
- **WHEN** user runs `rasen update`
- **AND** multiple new adapted tool directories are detected
- **THEN** the system SHALL display one consolidated message listing the detected adapted tools, for example: "Detected new tools: Claude Code, Codex. Run 'rasen init' to add them."
- **THEN** the system SHALL NOT automatically add any new tools
- **THEN** the system SHALL proceed with update for currently configured tools only

#### Scenario: No new adapted tool directories
- **WHEN** user runs `rasen update`
- **AND** no new adapted tool directories are detected
- **THEN** the system SHALL NOT display any tool detection message

## ADDED Requirements

### Requirement: Update tolerates already-configured unadapted tools
The update command SHALL continue to detect and refresh Rasen artifacts for a tool that is already configured on disk, even when that tool is not adapted and is therefore hidden from the install surface. Hiding a tool from selection SHALL NOT cause update to drop, orphan, or skip a previously configured install of that tool.

#### Scenario: Configured unadapted tool is refreshed
- **WHEN** a project already has Rasen artifacts installed for an unadapted tool (e.g. `.cursor/` with generated skill files)
- **AND** the user runs `rasen update`
- **THEN** the system SHALL treat that tool as configured
- **THEN** the system SHALL apply version and profile/delivery refresh to that tool's artifacts
- **AND** the system SHALL NOT skip the tool because it is unadapted

#### Scenario: Configured unadapted tool is not reported as a new tool
- **WHEN** a project already has Rasen artifacts installed for an unadapted tool
- **AND** the user runs `rasen update`
- **THEN** the system SHALL NOT display a "Detected new tool" message for that already-configured tool
