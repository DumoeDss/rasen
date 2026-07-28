## MODIFIED Requirements

### Requirement: Update respects global profile config
The update command SHALL read global config and apply profile settings to the project. Before reporting the project as already current, it SHALL also account for the managed Codex project policy when Codex is configured in the authoritative project tool manifest.

#### Scenario: Update adds missing workflows from config
- **WHEN** user runs `rasen update`
- **AND** global config specifies workflows not currently installed in the project
- **THEN** the system SHALL generate skill files for missing workflows
- **THEN** the system SHALL display: "Added: <workflow-names>"

#### Scenario: Update refreshes existing workflows
- **WHEN** user runs `rasen update`
- **AND** workflows are already installed in the project
- **THEN** the system SHALL refresh those workflow files with latest templates
- **THEN** the system SHALL display: "Updated: <workflow-names>"

#### Scenario: Update with no changes needed
- **WHEN** user runs `rasen update`
- **AND** installed workflows match global config
- **AND** all templates are current
- **AND** no leftover rasen command files remain
- **AND** every manifest-configured Codex policy is current
- **THEN** the system SHALL display: "Already up to date."

#### Scenario: Profile or delivery drift with current templates
- **WHEN** user runs `rasen update`
- **AND** workflow templates are current for the installed skills
- **AND** project files do not match the current profile selection
- **THEN** the system SHALL treat this as an update-required state (not "Already up to date.")
- **THEN** the system SHALL add/remove files to match the current profile selection

#### Scenario: Codex config drift with current templates
- **WHEN** user runs `rasen update`
- **AND** Codex is present in the authoritative project tool manifest
- **AND** workflow templates are current
- **AND** the managed Codex policy is missing or stale
- **THEN** the system SHALL treat this as an update-required state instead of displaying "Already up to date."
- **AND** the system SHALL reconcile the project-local Codex policy

#### Scenario: Update summary output
- **WHEN** update completes with changes
- **THEN** the system SHALL display a summary:
  - "Added: propose, explore" (new workflows installed)
  - "Updated: apply, archive" (existing workflows refreshed)
  - "Removed: 4 command files" (leftover rasen command files cleaned up)
- **THEN** the system SHALL list affected tools: "Tools: Claude Code, Cursor"

## ADDED Requirements

### Requirement: Update uses manifest authority for Codex config

`rasen update` SHALL inspect and reconcile `.codex/config.toml` only when Codex belongs to the configured-tool set resolved from `rasen/config.yaml`, including a one-time migration seed that explicitly resolves Codex. An unmanifested `.codex/` directory SHALL remain advisory-only.

#### Scenario: Manifest authorizes Codex config repair

- **WHEN** the project manifest contains `tools: [codex]`
- **AND** the project-local Codex policy is missing or stale
- **THEN** update SHALL reconcile `.codex/config.toml` even when Codex skill files are already current

#### Scenario: Other tools are configured

- **WHEN** the project manifest excludes Codex
- **AND** a `.codex/` directory or stale `.codex/config.toml` exists on disk
- **THEN** update SHALL leave `.codex/config.toml` unchanged
- **AND** existing new-tool detection SHALL continue to advise the user to run `rasen init`

#### Scenario: Migration resolves Codex

- **WHEN** the project has no `tools:` manifest and the existing one-time migration resolves Codex as configured
- **THEN** update SHALL persist Codex in the manifest before reconciling its project config
- **AND** subsequent updates SHALL use that manifest as the authority

### Requirement: Update reports Codex config results

`rasen update` SHALL report Codex policy changes and failures without counting the config file as a skill or claiming that a blocked project is already current.

#### Scenario: Update writes Codex config

- **WHEN** update creates or changes `.codex/config.toml`
- **THEN** the summary SHALL identify that Codex configuration changed
- **AND** the system SHALL instruct the user to restart Codex for the policy to affect a fresh session

#### Scenario: Update finds current config

- **WHEN** Codex is manifest-configured and its managed policy is already current
- **THEN** update SHALL avoid rewriting `.codex/config.toml`
- **AND** configuration alone SHALL NOT cause a restart instruction

#### Scenario: Update cannot safely repair config

- **WHEN** Codex is manifest-configured but `.codex/config.toml` is unreadable, structurally ambiguous, or cannot be written safely
- **THEN** update SHALL display the config path and an actionable reason
- **AND** update SHALL NOT display "Already up to date."
- **AND** the original config SHALL remain unchanged
